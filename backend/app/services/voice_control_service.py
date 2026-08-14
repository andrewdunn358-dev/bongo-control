"""
VoiceControlService — wake word + voice commands + talking to Ron, out
loud.

Architecture, and why it's shaped this way:

- Wake word detection runs entirely locally, continuously, for free,
  with no internet dependency. Deliberate: it's the one part of this
  pipeline that HAS to run all the time, so it can't depend on a
  connection or cost anything per listen.

  Uses Vosk's grammar-constrained recognition, NOT Porcupine and NOT
  openWakeWord - both ruled out by real, verified findings rather than
  preference. openWakeWord hard-requires either onnxruntime or
  tflite-runtime on Linux, and neither currently installs on this Pi's
  architecture (armv7): onnxruntime has never published official armv7
  wheels (confirmed against piwheels' own project page for it - zero
  files) and tflite-runtime was renamed to ai-edge-litert with a
  different import path. Porcupine's own wheel genuinely does bundle
  working Raspberry Pi binaries (confirmed by inspecting it) - but it
  requires a Picovoice Console account for even a free AccessKey, and
  that signup isn't available here. Vosk sidesteps both problems: it
  publishes a real armv7l wheel directly on PyPI (confirmed - not
  inferred - by downloading it with `pip download --platform
  linux_armv7l`), and needs no account or key at all, just downloading
  its own small model file from a public URL on first run (then cached
  on the persistent data volume - see docker-compose.yml). Grammar mode
  (KaldiRecognizer(model, rate, json_list_of_phrases)) constrains
  recognition to a couple of phrases instead of open vocabulary, which
  is what makes it function as a wake-word detector rather than a full
  transcription engine running continuously. Heavier per-cycle than a
  purpose-built wake-word net like Porcupine's would have been - worth
  keeping an eye on Pi 2 CPU headroom once this is actually running;
  the trade for not needing an account judged worth it here.

- Everything AFTER the wake word — transcription, understanding what
  was said, generating a spoken reply — goes to Groq (Whisper STT, then
  either a direct relay command or Ron's existing chat, then Groq
  TTS). This Pi is genuinely too weak to run that stack locally — every
  current guide for the full stack calls a Pi 4 the recommended
  minimum. So the honest trade is: voice commands need a connection to
  actually DO anything, same as every other AI feature this app
  already has (the "AI picks" card, Ron's text chat).

- Talks to ALSA hardware directly (via device strings like "hw:2,0"),
  not through the host's PipeWire session. Same reasoning as the
  camera talking straight to /dev/video0 rather than any desktop video
  service: a Docker container doesn't have a clean way into a host
  user's PipeWire session without bridging its socket and UID, and
  direct hardware access is simpler, and already proven to work in
  this codebase.

Safety, non-negotiable: the roof is NEVER reachable by voice, under any
phrasing, ever. This is not a filter bolted onto the command matcher —
the vocabulary of voice-controllable things is built by excluding
roof_service.managed_channel_ids from relay_service's channel list, the
exact same authoritative source app/api/routes/relays.py already uses
to refuse a plain on/off on the roof over the HTTP API. A roof channel
is never even a candidate the parser could match against, regardless of
what gets said.
"""

from __future__ import annotations

import asyncio
import audioop
import io
import json
import logging
import math
import queue
import re
import struct
import subprocess
import tempfile
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.services.ai_chat_service import ChatMessage, ai_chat_service
from app.services.configuration_service import configuration_service
from app.services.relay_service import relay_service
from app.services.roof_service import roof_service
from app.services.internet_radio_service import internet_radio_service

logger = logging.getLogger("vanos.voice_control_service")

# No fixed sample rate constant here deliberately - the wake-word
# listener uses the actual microphone's own native rate at runtime
# (see _listen_loop()), not a hardcoded value. Reported symptom that
# drove this: "Invalid sample rate [PaErrorCode -9997]" - PortAudio
# talks to hardware directly with no automatic rate conversion (unlike
# arecord/aplay elsewhere in this file, which go through ALSA's own
# "plug" layer), so forcing 16kHz failed on a mic that doesn't support
# it natively. Vosk's KaldiRecognizer accepts and internally resamples
# from whatever rate it's told, so the fix is telling it the truth
# about the device's real rate rather than forcing one on the hardware.

# On the persistent data volume (see docker-compose.yml's vanos-data
# mount) so the ~40MB model downloads once, not on every container
# rebuild.
VOSK_MODEL_DIR = "/app/data/vosk-models"
# A specific, known-good small English model, downloaded directly (see
# _load_vosk_model() for why - vosk's own lang="en" auto-resolution
# has a dangerous failure mode worth avoiding entirely).
VOSK_MODEL_NAME = "vosk-model-small-en-us-0.15"
VOSK_MODEL_URL = f"https://alphacephei.com/vosk/models/{VOSK_MODEL_NAME}.zip"

# Reverted back on same night - Andrew's call: the mic is working fine
# right now, this shouldn't have been disabled on a guess about hardware
# that wasn't actually confirmed still broken. Both this path and Groq
# already command an absolute ON or OFF directly, never a toggle, never
# dependent on assumed prior state - that's the whole design, and it
# was never the problem.
OFFLINE_RELAY_COMMANDS_ENABLED = True

# How long to record after the wake word fires. Reported concern: a
# full interaction taking ~18 real seconds end to end wouldn't impress
# anyone shown it - a fixed, invisible-in-the-logs 5s recording window
# was a big, unnecessary chunk of that, every single time, however
# short the actual command was to say. 4s is still comfortably enough
# for a short command ("turn the heater on") without paying for 5
# regardless. A whole number deliberately - arecord's own -d flag only
# accepts whole seconds, and str(int(3.5)) would have silently
# truncated to 3 rather than rounding, quietly lying about what it
# actually did. Not silence-detection (stop recording the moment
# speech ends, which would be the properly optimal fix) - that's real
# additional engineering; this is the honest, fast, low-risk trim.
COMMAND_RECORD_SECONDS = 4.0

# Adaptive/silence-based recording - the "real additional engineering"
# the note above already flagged as the properly optimal fix, now
# built. Real reported gap this closes: a fixed window either cuts off
# a longer natural question ("what's the weather and how's the
# battery") mid-sentence, or - if lengthened to avoid that - makes
# every short command ("lights on", the common case) needlessly slower
# for no reason. Adaptive solves both: keeps listening while there's
# real speech, stops shortly after it actually pauses, whichever
# happens first.
MAX_COMMAND_RECORD_SECONDS = 12.0  # hard safety cap regardless of speech - must never record forever
MIN_COMMAND_RECORD_SECONDS = 1.0  # never stop earlier than this even if the silence logic misfires early
INITIAL_SILENCE_GRACE_SECONDS = 3.0  # how long to wait for speech to START before giving up entirely
TRAILING_SILENCE_SECONDS = 1.3  # how long a pause AFTER speech has started counts as "finished talking"
RECORD_CHUNK_SECONDS = 0.1  # how often the silence detector re-checks - small enough to feel responsive
# The go-ahead confirm beep (_generate_beep_wav's default, 0.25s) plays
# CONCURRENTLY with the start of recording, deliberately - not one
# after another - so recording is already live before the beep even
# finishes, avoiding losing a fast talker's first word. Real bug this
# caused: the beep itself is loud (a plain tone, easily above the RMS
# threshold), so it was triggering speech_started=True on its OWN
# sound - which then started the SHORT TRAILING_SILENCE_SECONDS
# countdown instead of the generous INITIAL_SILENCE_GRACE_SECONDS one.
# Any real gap after the beep before actual words begin (Groq's own
# TTS generation latency in the "Test without going to the van" flow,
# or just normal human reaction time saying it live) then read as
# "they've finished talking" and cut the recording off before the real
# command was ever spoken - confirmed live: transcribed as literally
# "BEEP!", nothing else, because that beep tone was the only audio the
# recording ever actually captured. Audio during this window is still
# CAPTURED normally (nothing is lost) - only the speech-detection
# decision is suppressed until the beep's own known duration has
# passed, so it can't be mistaken for the person having started (or
# finished) talking.
BEEP_IGNORE_SECONDS = 0.5  # the 0.25s beep itself, plus margin for acoustic tail/propagation
# Confirmed via real logged RMS levels (13 Aug testing): this hardware's
# background noise floor genuinely sits at 489-899 minimum, well above
# the original 400 guess - meaning "silence" never actually read as
# silence, and recording ran to the full MAX_COMMAND_RECORD_SECONDS
# cap every single time regardless of what was actually said. Raised
# to sit clearly above the observed noise floor. Still not a fully
# tuned number - genuine human speech at normal mic distance (not the
# TTS-through-speaker test, which is unusually direct/loud) hasn't
# been measured yet, so this may still need adjusting either way once
# tested with an actual voice. Configurable via Settings
# (voice_speech_rms_threshold) specifically so that's a Settings
# change, not a redeploy - see _speech_rms_threshold().
DEFAULT_SPEECH_RMS_THRESHOLD = 2500

# Used only by speak_test_phrase() - the pause between speaking the
# wake word and speaking the command, simulating the beat a real
# person should leave after the beep. Generous on purpose: covers wake
# detection + the beep's own 0.25s + the mic close/reopen handoff +
# arecord's own startup, so the command clip reliably lands inside the
# real recording window rather than racing it.
WAKE_TEST_PAUSE_SECONDS = 2.0

GROQ_STT_MODEL = "whisper-large-v3-turbo"  # fast + cheap - see ai_chat_service.py's cost-discipline notes; a short command doesn't need the slower, pricier non-turbo model
GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
# Confirmed against a real 400 from Groq listing the actual valid set:
# autumn, diana, hannah, austin, daniel, troy. Was "diana" (matched the
# persona's old name, "Diane") - switched to a male-coded voice now the
# persona's "Ron" (Ron Burgundy, after the van's own burgundy colour).
# "daniel" is a reasonable pick for a warm, confident, van-companion
# voice; easy one-line change if it doesn't land right in practice,
# same as the original tara->diana pivot was.
DEFAULT_GROQ_TTS_VOICE = "daniel"

# "Computer" out of the box, deliberately - works immediately with zero
# extra setup, no account, no training step. Vosk's grammar mode can
# match any short phrase, so this is trivially changeable later
# (general.voice_wake_word in Settings) - "Ron" itself is a fine
# choice too once this is proven working, just a one-line config
# change, no retraining pipeline needed (unlike Porcupine's custom
# wake words, which need a console + training step).
DEFAULT_WAKE_WORD = "computer"

DEFAULT_MIC_DEVICE = "default"  # ALSA device string, e.g. "hw:2,0" - see Settings
DEFAULT_PLAYBACK_DEVICE = "default"  # e.g. "hw:1,0" for the Pi's own jack, or the USB DAC once fitted

# Follow-up conversation, without repeating the wake word each time.
# After speaking a reply, _handle_wake() listens again immediately
# (silently - no beep, the reply just finishing IS the cue) using the
# same adaptive recording as the first turn. If real speech is picked
# up within its own INITIAL_SILENCE_GRACE_SECONDS, that's treated as a
# continuation of the same conversation - carrying the same
# conversation history, no "computer" needed. If nothing's said, the
# session ends there and the next interaction needs the wake word
# again, same as before this existed.
#
# Disabled for now (FOLLOWUP_CONVERSATION_ENABLED). Confirmed live: a
# genuinely elevated background noise floor on this hardware (see
# DEFAULT_SPEECH_RMS_THRESHOLD's own note) caused a false-positive
# follow-up - background noise alone was enough to register as
# "someone's still talking", triggering a full unwanted recording +
# transcription + a genuinely unprompted Ron reply about battery
# status, burning real Groq quota for an interaction nobody asked for.
# A false MISS on a real follow-up just costs saying "computer" again
# - mildly annoying. A false POSITIVE costs an unwanted interruption
# and real API spend - a worse failure mode, so this stays off until
# the noise floor / threshold situation is confirmed properly sorted
# with real speech testing, not just the raised threshold guess.
FOLLOWUP_CONVERSATION_ENABLED = False
MAX_FOLLOWUP_TURNS = 6  # a generous safety bound against a genuinely runaway loop, not a real UX limit anyone should hit
# Each exchange is 2 entries (user + assistant) - 12 keeps roughly the
# last 6 exchanges. Bounded so a long conversation doesn't grow the
# prompt (and Groq's bill) without limit; old context past this simply
# ages out rather than the conversation breaking.
MAX_CONVERSATION_HISTORY_MESSAGES = 12


@dataclass
class _RecordResult:
    wav_bytes: bytes
    # Whether the recorder actually detected speech above the RMS
    # threshold, vs. just silence for the whole listening window. Lets
    # the follow-up loop decide "did they say something else" without
    # needing to round-trip a near-silent clip through Groq first just
    # to find out - _record_command_clip_fixed() (the non-adaptive
    # fallback) can't know this, so it always reports True, since it's
    # normally only reached on the FIRST turn anyway, where we already
    # know the wake word fired.
    speech_detected: bool


class VoiceControlUnavailableError(RuntimeError):
    pass


class VoiceControlService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stream = None  # sounddevice.RawInputStream, created lazily - see _listen_loop()
        self._stream_kwargs: dict | None = None  # to recreate the stream around each command recording - see _handle_wake()
        self._enabled = False
        self._last_wake_at: float | None = None
        self._last_command_text: str | None = None
        self._last_reply_text: str | None = None
        self._last_error: str | None = None
        self._processing = False
        # Cached Vosk model instance - loaded once, shared by both the
        # wake-word listener AND the offline relay-command recognizer
        # below (see _load_vosk_model()'s caching). A Vosk Model is a
        # read-only set of weights safe to share across multiple
        # KaldiRecognizer instances; only the recognizer itself carries
        # per-utterance state.
        self._vosk_model = None
        # Conversation memory for the current wake-word session (the
        # original trigger plus however many follow-up turns come after
        # it, until the first silent gap ends it) - see _handle_wake()
        # (resets this fresh) and _run_conversation_turn() (appends to
        # it, trims to MAX_CONVERSATION_HISTORY_MESSAGES). Deliberately
        # NOT persisted across separate sessions - a brand new "computer,
        # ..." shouldn't inherit context from an unrelated conversation
        # from an hour ago.
        self._conversation_history: list[ChatMessage] = []

    # ---------------------------------------------------------- config

    @staticmethod
    def _general() -> dict[str, Any]:
        return configuration_service.get("general", {}) or {}

    def _groq_api_key(self) -> str:
        return str(self._general().get("groq_api_key") or "").strip()

    def _wake_word(self) -> str:
        return str(self._general().get("voice_wake_word") or "").strip().lower() or DEFAULT_WAKE_WORD

    def _mic_device(self) -> str:
        return str(self._general().get("voice_mic_device") or "").strip() or DEFAULT_MIC_DEVICE

    def _resolve_arecord_device(self) -> str:
        """The SAME voice_mic_device setting is used two incompatible
        ways: _resolve_sd_input_device() below matches it as a
        descriptive NAME substring against sounddevice's own device
        list (that's genuinely how PortAudio works, and correct for the
        always-on listener) - but arecord (used for the per-command
        recording in _record_command_clip) needs a real ALSA device
        string like "plughw:2,0", not a description. Reported bug:
        "Unknown PCM USB Audio Device" - the exact same config value
        that correctly told the wake-word listener which mic to use was
        being handed straight to `arecord -D`, which has no idea what
        to do with a plain name at all.

        Resolves properly instead of requiring two different-shaped
        values in one field: if the configured value already looks like
        real ALSA syntax (starts with a recognised prefix), use it
        as-is - unchanged from before, so an already-correct
        "plughw:2,0" style value (like the speaker field already uses)
        keeps working exactly as it did. Otherwise, treat it as a name
        to look up: parse `arecord -l`'s own output (the same listing
        used to debug this by hand tonight) for a card whose
        description contains it, and build "plughw:N,0" from whatever
        card number that actually is right now - not a hardcoded
        number, so this keeps working even if the card's number shifts
        on a future reconnect (which it did, repeatedly, tonight).
        """
        configured = self._mic_device().strip()
        if not configured or configured == DEFAULT_MIC_DEVICE:
            return "default"
        if any(configured.lower().startswith(prefix) for prefix in ("plughw:", "hw:", "default", "sysdefault")):
            return configured  # already real ALSA syntax - pass through unchanged

        try:
            result = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=5)
            for line in result.stdout.splitlines():
                # arecord -l lines look like: "card 2: Device [USB Audio Device], device 0: ..."
                if line.startswith("card ") and configured.lower() in line.lower():
                    card_num = line.split("card ", 1)[1].split(":", 1)[0].strip()
                    return f"plughw:{card_num},0"
        except Exception as e:  # noqa: BLE001 - fall back to "default" rather than block recording entirely
            logger.warning("Voice control: could not resolve mic device name %r via arecord -l, falling back to default: %s", configured, e)

        logger.warning("Voice control: no card matched mic device name %r, falling back to default", configured)
        return "default"

    def _playback_device(self) -> str:
        return str(self._general().get("voice_playback_device") or "").strip() or DEFAULT_PLAYBACK_DEVICE

    def _speech_rms_threshold(self) -> float:
        """How loud (in raw 16-bit PCM RMS) counts as 'someone is
        speaking' for the adaptive recording cutoff. DEFAULT_SPEECH_RMS_THRESHOLD
        is a starting guess, not a verified number - if commands keep
        getting cut off early, or keep running to the max length even
        for short phrases, this needs adjusting up or down from real
        testing. Configurable so that's a Settings change, not a
        redeploy."""
        raw = self._general().get("voice_speech_rms_threshold")
        try:
            return float(raw) if raw not in (None, "") else float(DEFAULT_SPEECH_RMS_THRESHOLD)
        except (TypeError, ValueError):
            return float(DEFAULT_SPEECH_RMS_THRESHOLD)

    def _mic_gain(self) -> float:
        """Digital gain multiplier applied to raw mic audio before it
        reaches Vosk or gets recorded - both the always-on wake-word
        listener and the adaptive command recording use this. Needed
        because the actual mic hardware's own Capture level is already
        at its maximum (confirmed: 100%, no separate boost control
        exists on this device) - there's nowhere further to go at the
        hardware level, so any more sensitivity has to come from
        software instead. Real motivating case: the mic will sit
        mounted high up in the van, further from a speaking voice than
        the close, on-the-body range a lavalier mic is actually
        designed for.

        1.0 = no change. Genuinely untested against the real, final
        mounted position - a reasonable starting point, not a verified
        number. Digital gain amplifies whatever's already captured,
        background noise included - it doesn't recover detail that was
        never captured in the first place, so there's a real ceiling to
        how much this alone can compensate for distance. Configurable
        via Settings (voice_mic_gain) so it's a Settings change, not a
        redeploy, once the mic's actually mounted where it'll live and
        this can be tuned against reality.
        """
        raw = self._general().get("voice_mic_gain")
        try:
            return float(raw) if raw not in (None, "") else 1.0
        except (TypeError, ValueError):
            return 1.0

    def _apply_mic_gain(self, chunk: bytes) -> bytes:
        """Applies _mic_gain() to a raw 16-bit PCM chunk. audioop.mul()
        saturates (clamps) rather than wrapping on overflow, so pushing
        the gain too high produces clipping/distortion rather than
        garbage-value wraparound - still worth not setting this
        extremely high, but a bad value fails towards "sounds harsh"
        rather than towards silent corruption. A gain of exactly 1.0
        skips the multiply entirely - the common case (not yet tuned,
        or deliberately left at unity) shouldn't pay for it."""
        gain = self._mic_gain()
        if gain == 1.0:
            return chunk
        return audioop.mul(chunk, 2, gain)

    def is_configured(self) -> bool:
        # Only the Groq key gates this - Vosk needs no account/key at
        # all, just its model (auto-downloaded on first run).
        return bool(self._groq_api_key())

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "configured": self.is_configured(),
            "listening": self._stream is not None,
            "processing": self._processing,
            "mic_device": self._mic_device(),
            "playback_device": self._playback_device(),
            "wake_word": self._wake_word(),
            "last_wake_at": self._last_wake_at,
            "last_command_text": self._last_command_text,
            "last_reply_text": self._last_reply_text,
            "last_error": self._last_error,
            "voice_controllable_relays": sorted(self._voice_controllable_relays().keys()),
        }

    # --------------------------------------------------------- safety

    def _voice_controllable_relays(self) -> dict[str, int]:
        """Name (lowercased) -> channel id, for exactly the relays voice
        is allowed to touch. See the module docstring for why roof
        exclusion happens here, structurally, rather than as a filter
        applied after matching."""
        try:
            channels = relay_service.status().get("channels", [])
        except Exception:  # noqa: BLE001 - relay control being unavailable shouldn't crash voice status
            return {}
        roof_ids = roof_service.managed_channel_ids
        return {
            str(c["name"]).strip().lower(): c["id"]
            for c in channels
            if c.get("id") not in roof_ids and c.get("name")
        }

    @staticmethod
    def _current_commanded_on(channel_id: int) -> bool:
        """The last-known commanded state for one channel - used to
        compute a toggle direction (see _handle_wake()'s two relay-
        command branches). Defaults to False (so a lookup failure
        toggles to ON rather than silently doing nothing) - genuinely
        best-effort, never raises."""
        try:
            channels = relay_service.status().get("channels", [])
            return bool(next((c.get("commanded_on") for c in channels if c.get("id") == channel_id), False))
        except Exception:  # noqa: BLE001
            return False

    def _match_relay_command(self, text: str) -> tuple[int, bool, str] | None:
        """A fixed, tiny grammar - not a second LLM call. A short list
        of physical actions matched by keyword is more reliable AND far
        cheaper than asking a model to interpret 'turn the lights on'
        every single time, and it's the safety-relevant path: simple to
        read, simple to audit, nothing probabilistic about what it will
        or won't do. Returns None (falls through to Ron) for anything
        that isn't clearly an on/off request against a known relay name.

        Uses word-boundary regex, not fixed bigrams. Reported bug: "turn
        the lights on" - a completely natural, arguably more common
        phrasing than "turn on the lights" - didn't match at all,
        because the original version only checked for the literal
        substring "turn on" (verb immediately followed by particle,
        with nothing in between). Real people put the object in the
        middle. \\bon\\b / \\boff\\b as standalone words (so "off" doesn't
        accidentally match inside another word, and "on" doesn't match
        inside "one") plus a separate check for an action verb anywhere
        in the sentence correctly catches both word orders.

        Second reported gap: a bare "lights off" (no verb at all) never
        matched, since an action verb was required unconditionally -
        it fell through to Ron every single time, who has no relay
        awareness in his own context and answers oddly when asked to
        control one directly (this is what looked like "lost connection
        to the relays" but was actually a phrasing gap, not a real
        fault - confirmed via the actual logs: relay_service was never
        touched, and _match_relay_command simply returned None for that
        text). "Lights off" and "heater on" are genuinely natural short
        commands, arguably more common than the full verb sentence.
        Accepted now WITHOUT a verb, but only as a tight, ADJACENT
        bigram (name immediately next to on/off) - not "anywhere in the
        sentence" the way the verb path is. Adjacency keeps this safe:
        a longer, unrelated sentence that happens to mention a relay
        name and the word "on"/"off" somewhere far apart from each
        other won't accidentally trigger a real physical action just
        because both words showed up somewhere.
        """
        t = text.lower().strip()
        relays = self._voice_controllable_relays()
        if not relays:
            return None

        has_action_verb = re.search(r"\b(turn|switch|put)\b", t) is not None
        has_on = re.search(r"\bon\b", t) is not None
        has_off = re.search(r"\boff\b", t) is not None
        if has_on == has_off:  # neither present, or (ambiguously) both
            return None
        turn_on = has_on

        for name, channel_id in relays.items():
            # Reported bug: heard "Turn the light on." for a relay
            # configured as "lights" - the exact literal name never
            # matched, since Whisper transcribes the natural singular
            # ("the light") as often as the plural, regardless of which
            # the relay happens to be named. Fell through to Ron
            # silently, whose reply then took a genuinely long time to
            # synthesize and speak - what looked like a slow relay was
            # actually a wrong turn, not a delay. Check both forms, not
            # just the one literally configured. Word-boundary matching
            # (not a raw substring check) so "light" can't accidentally
            # match inside some unrelated longer word either way.
            candidates = [name]
            if name.endswith("s"):
                candidates.append(name[:-1])
            for candidate in candidates:
                esc = re.escape(candidate)
                if not re.search(rf"\b{esc}\b", t):
                    continue
                if has_action_verb:
                    return channel_id, turn_on, name
                if re.search(rf"\b{esc}\s+(on|off)\b", t) or re.search(rf"\b(on|off)\s+{esc}\b", t):
                    return channel_id, turn_on, name
        return None

    # ---------------------------------------------------------- audio

    def _generate_beep_wav(self, frequency_hz: float = 880.0, duration_s: float = 0.25, sample_rate: int = 16000) -> bytes:
        """A short, plain sine-wave beep, generated locally - no API
        call, no network dependency, instant (unlike synthesizing a
        real word via Groq for this). Played immediately after the wake
        word is detected, before recording starts - an audible "go
        ahead, talk now" cue.

        Reported symptom this addresses: commands recognized correctly
        only ~1 in 10 tries, repeatedly coming back as just "." -
        Whisper's own signal for "mostly silence, nothing clear to
        transcribe". The likely cause: there's real latency between the
        wake word actually being detected and arecord's capture
        actually starting (closing/reopening the audio stream, spinning
        up a fresh subprocess) - with nothing marking when that window
        opens, saying the command straight after the wake word (the
        natural way to speak it) means the words often land mostly
        BEFORE recording starts, not during it. Every commercial voice
        assistant has this same underlying delay and solves it the same
        way: a cue sound, then a beat for the person to actually start
        talking.
        """
        n_samples = int(duration_s * sample_rate)
        fade_samples = max(1, int(sample_rate * 0.03))  # short fade in/out avoids an audible click/pop
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            frames = bytearray()
            for i in range(n_samples):
                envelope = min(1.0, i / fade_samples, (n_samples - i) / fade_samples)
                sample = int(32767 * 0.3 * envelope * math.sin(2 * math.pi * frequency_hz * i / sample_rate))
                frames += struct.pack("<h", sample)
            wf.writeframes(bytes(frames))
        return buf.getvalue()

    def _record_command_clip(self) -> _RecordResult:
        """Primary entry point - tries adaptive, silence-based recording
        first, falling back to the old reliable fixed-duration approach
        if anything about the adaptive path throws. This function
        previously WAS the fixed-duration implementation directly;
        that logic still exists, unchanged, as _record_command_clip_fixed()
        below, specifically as a safety net - genuinely can't test the
        new streaming/RMS logic against real hardware from where this
        was written, so if it misbehaves in a way not caught here,
        voice control degrades to exactly how it worked before rather
        than breaking outright."""
        try:
            return self._record_command_clip_adaptive()
        except Exception as e:  # noqa: BLE001 - the whole point of this fallback
            logger.warning("Voice control: adaptive recording failed (%s), falling back to fixed-duration", e)
            return _RecordResult(wav_bytes=self._record_command_clip_fixed(), speech_detected=True)

    def _record_command_clip_adaptive(self) -> _RecordResult:
        """Records via `arecord` streamed as raw PCM to stdout (not a
        fixed -d duration to a file) so this can watch the audio as it
        arrives and decide when the person's actually finished talking,
        rather than always waiting a fixed window. Reuses
        _resolve_arecord_device() and the 44100Hz rate exactly as the
        fixed-duration path does - both proven working against this
        actual hardware; only HOW the output is consumed changes here.

        State machine, checked every RECORD_CHUNK_SECONDS:
        - Before any speech is detected: keep waiting, up to
          INITIAL_SILENCE_GRACE_SECONDS - covers the real gap between
          the beep and someone actually starting to talk. If nothing's
          said at all in that window, give up (an empty/near-silent
          clip goes to transcription same as before, which already
          handles that case).
        - Once speech is detected (RMS above the configured threshold):
          keep recording. A sustained quiet patch of TRAILING_SILENCE_SECONDS
          is read as "they've finished the sentence" and stops early -
          this is what lets a short command finish fast.
        - MAX_COMMAND_RECORD_SECONDS is a hard cap regardless of any of
          the above - a longer natural question gets real room to
          breathe, but this can't run forever.
        """
        device = self._resolve_arecord_device()
        sample_rate = 44100
        chunk_frames = max(1, int(sample_rate * RECORD_CHUNK_SECONDS))
        chunk_bytes = chunk_frames * 2  # 16-bit mono = 2 bytes/sample
        threshold = self._speech_rms_threshold()

        proc = subprocess.Popen(
            ["arecord", "-D", device, "-f", "S16_LE", "-r", str(sample_rate), "-c", "1", "-t", "raw"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        frames = bytearray()
        speech_started = False
        silence_run_start: float | None = None
        start_time = time.monotonic()
        # Diagnostic only, temporary: the reported symptom (recording
        # ran the full 12s cap even with ~9s of genuine silence
        # afterward, on two consecutive attempts) points at the RMS
        # threshold being too low for this hardware's real background
        # noise floor - but that's a theory, not confirmed yet. Log the
        # actual measured levels (not just a final summary) so the next
        # real test shows the true numbers instead of guessing further.
        rms_min = float("inf")
        rms_max = 0.0
        last_log_time = start_time
        try:
            while True:
                elapsed = time.monotonic() - start_time
                if elapsed >= MAX_COMMAND_RECORD_SECONDS:
                    logger.info("Voice control: adaptive recording hit the %.0fs safety cap", MAX_COMMAND_RECORD_SECONDS)
                    break

                chunk = proc.stdout.read(chunk_bytes) if proc.stdout else b""
                if not chunk:
                    break  # arecord exited unexpectedly - stop with whatever we've got
                if len(chunk) % 2:
                    chunk = chunk[:-1]  # a pipe read can land on an odd byte count - audioop.rms needs whole 16-bit frames
                if not chunk:
                    continue
                chunk = self._apply_mic_gain(chunk)
                frames.extend(chunk)

                rms = audioop.rms(chunk, 2)
                rms_min = min(rms_min, rms)
                rms_max = max(rms_max, rms)
                now = time.monotonic()
                if now - last_log_time >= 1.0:
                    logger.info("Voice control: TIMING adaptive-recording rms=%d (threshold=%d) at %.1fs", rms, threshold, elapsed)
                    last_log_time = now

                if elapsed < BEEP_IGNORE_SECONDS:
                    # Still capturing (frames.extend already ran above)
                    # but not making any speech-detection decision yet -
                    # this window is where the go-ahead beep's own sound
                    # lives, and it must never count as "the person
                    # started talking" or "the person stopped talking".
                    continue

                if rms > threshold:
                    speech_started = True
                    silence_run_start = None
                elif speech_started:
                    if silence_run_start is None:
                        silence_run_start = now
                    elif (now - silence_run_start) >= TRAILING_SILENCE_SECONDS and elapsed >= MIN_COMMAND_RECORD_SECONDS:
                        break  # said something, then paused for long enough - they're done
                elif elapsed >= INITIAL_SILENCE_GRACE_SECONDS:
                    break  # never started talking at all - give up rather than record silence for 12s
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()

        logger.info("Voice control: TIMING adaptive-recording rms range over whole recording: min=%d max=%d threshold=%d", rms_min, rms_max, threshold)

        recorded_seconds = time.monotonic() - start_time
        logger.info(
            "Voice control: adaptive recording finished after %.1fs (%s), %d bytes captured",
            recorded_seconds, "speech detected" if speech_started else "no speech detected", len(frames),
        )

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(bytes(frames))
        return _RecordResult(wav_bytes=buf.getvalue(), speech_detected=speech_started)

    def _record_command_clip_fixed(self) -> bytes:
        """Records COMMAND_RECORD_SECONDS of audio via `arecord` (a
        plain ALSA CLI capture, same "shell out to a well-tested real
        tool" pattern as ffmpeg for the camera) and returns it as WAV
        bytes. Blocking - always called via asyncio.to_thread, never
        directly on the event loop (same reasoning as every other
        subprocess call in this codebase that touches real hardware -
        see camera_service.py).

        Kept as the fallback safety net for _record_command_clip() -
        see that function's docstring. This was the primary recording
        path before adaptive/silence-based recording was added; the
        logic here is otherwise unchanged.

        Note on why this doesn't just crash outright when the wake-word
        listener is holding the same mic open: ALSA hardware devices
        generally allow only one exclusive consumer at a time, same
        single-consumer limitation the camera already has. See
        _handle_wake()'s _reopen_mic_and_record() for how that's
        actually avoided - it fully closes the listener's stream
        (releasing the hardware, not just pausing it - an earlier
        pause-only attempt didn't release the ALSA handle and arecord
        still saw the device as busy) before this runs, then reopens a
        fresh stream afterward.

        Records at 44100Hz, not 16000 - found the hard way setting up a
        new USB sound card: forcing this card to 16000Hz through ALSA's
        plughw resampling layer produced dead silence, every time, with
        no error at all - arecord reported success, the file was the
        right size, just silent. Recording at the card's own comfortable
        native-ish rate (44100 - close to universal across consumer
        audio hardware) and letting Groq/Vosk handle whatever rate
        actually comes back worked cleanly. Neither Whisper nor Vosk's
        KaldiRecognizer (see _try_offline_relay_command, which reads
        the rate straight out of the WAV header rather than assuming a
        fixed number) cares what rate this file is at - forcing 16000
        was gaining nothing and silently breaking a real device.
        """
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            path = Path(f.name)
        try:
            device = self._resolve_arecord_device()
            logger.info("Voice control: recording command for %.0fs via arecord on %s", COMMAND_RECORD_SECONDS, device)
            result = subprocess.run(
                [
                    "arecord",
                    "-D", device,
                    "-f", "S16_LE",
                    "-r", "44100",
                    "-c", "1",
                    "-d", str(int(COMMAND_RECORD_SECONDS)),
                    str(path),
                ],
                capture_output=True,
                timeout=COMMAND_RECORD_SECONDS + 5,
            )
            if result.returncode != 0:
                # Reported gap: a bare CalledProcessError's default str()
                # only shows the command and exit code, not WHY it
                # failed - "returned non-zero exit status 1" told
                # Andrew nothing actionable. arecord's own stderr (its
                # actual reason - device busy, no such device, whatever
                # it is) is right here; surface it instead of hiding it.
                stderr = result.stderr.decode(errors="replace").strip()
                raise VoiceControlUnavailableError(f"arecord failed: {stderr or f'exit code {result.returncode}'}")
            logger.info("Voice control: recording finished, %d bytes captured", path.stat().st_size)
            return path.read_bytes()
        finally:
            path.unlink(missing_ok=True)

    def _play_clip(self, audio_bytes: bytes, suffix: str = ".wav") -> None:
        """Plays audio straight through ALSA via `aplay`. Same blocking-
        subprocess-via-to_thread rule as _record_command_clip.

        Logs clearly before and after, specifically so this is watchable
        via `docker compose logs -f backend` while testing - if aplay
        exits 0, that's a genuine, meaningful signal: it means the Pi
        successfully handed real audio data to the sound card. What
        happens after that (whether the amp's on, volume up, right
        input selected) is downstream of this and a separate thing to
        check if nothing's audible despite a clean success here.

        Ducks internet radio around every call here (beep or TTS reply
        alike - both share this one choke point), not just "real"
        replies - anything on the shared speaker should pause the
        stream, not just spoken ones. duck()/unduck() never raise, and
        the unduck() is in `finally` so a failed aplay call still hands
        the radio back.
        """
        device = self._playback_device()
        internet_radio_service.duck()
        try:
            logger.info("Voice control: playing %d bytes of audio via aplay on %s", len(audio_bytes), device)
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(audio_bytes)
                path = Path(f.name)
            try:
                result = subprocess.run(
                    ["aplay", "-D", device, str(path)],
                    capture_output=True,
                    timeout=60,
                )
                if result.returncode != 0:
                    stderr = result.stderr.decode(errors="replace").strip()
                    raise VoiceControlUnavailableError(f"aplay failed: {stderr or f'exit code {result.returncode}'}")
                logger.info("Voice control: aplay finished cleanly (exit 0) - audio was sent to the sound card")
            finally:
                path.unlink(missing_ok=True)
        finally:
            internet_radio_service.unduck()

    # ------------------------------------------------------ groq calls

    def _groq_client(self):
        from groq import Groq  # local import - only needed once actually configured

        return Groq(api_key=self._groq_api_key())

    def _transcribe(self, wav_bytes: bytes) -> str:
        client = self._groq_client()
        transcription = client.audio.transcriptions.create(
            file=("command.wav", wav_bytes),
            model=GROQ_STT_MODEL,
            response_format="text",
            language="en",
        )
        return str(transcription).strip()

    def _synthesize(self, text: str) -> bytes:
        logger.info("Voice control: asking Groq to speak %r", text)
        client = self._groq_client()
        try:
            response = client.audio.speech.create(
                model=GROQ_TTS_MODEL,
                voice=DEFAULT_GROQ_TTS_VOICE,
                input=text,
                response_format="wav",
            )
        except Exception as e:  # noqa: BLE001 - deliberately broad, narrowed by isinstance below (groq is a soft/optional import - see _groq_client())
            from groq import RateLimitError

            if isinstance(e, RateLimitError):
                # Reported symptom: a raw nested-JSON error dump in the
                # status card - technically accurate but genuinely ugly,
                # and worse, it obscured the actually reassuring part:
                # everything BEFORE this point worked fine (heard it
                # correctly, matched or asked Ron, got a real reply -
                # self._last_reply_text is already set by the caller
                # before this runs) - only the SPOKEN version failed.
                # Groq's TTS voice has its own separate, small daily
                # quota from the rest of the account, and a single
                # heavy testing session can burn through it - not a
                # bug, just worth explaining plainly rather than
                # dumping the raw API error.
                logger.warning("Voice control: Groq TTS rate-limited: %s", e)
                raise VoiceControlUnavailableError(
                    "Reply generated fine, but Groq's daily voice quota is used up for now "
                    "(a busy testing session adds up fast - it's a small separate allowance "
                    "from the rest of the account). Resets within a few hours; the text reply "
                    "above is still real, it just couldn't be spoken this time."
                ) from e
            raise
        audio = response.read()
        logger.info("Voice control: got %d bytes of speech audio back from Groq", len(audio))
        return audio

    # ----------------------------------------------------- the pipeline

    async def trigger_test(self) -> dict[str, Any]:
        """Manual test entrypoint - runs the exact same record -> transcribe
        -> act/think -> speak pipeline the wake word normally triggers,
        without needing the wake word to actually fire. Lets the real
        pipeline (the part that actually matters) be tested and proven
        independently of the wake-word listener, and without needing a
        backend restart every time a key changes."""
        if not self._groq_api_key():
            raise VoiceControlUnavailableError("No Groq API key set - add one above first")
        if self._processing:
            # _handle_wake() itself would just silently skip a second
            # call (see its own docstring) - fine for the real listener,
            # but a person tapping a test button deserves to know why
            # nothing happened rather than seeing stale status.
            raise VoiceControlUnavailableError("Already processing another voice interaction - wait a moment and try again")
        await self._handle_wake()
        return self.status()

    async def speak_test_phrase(self, command_text: str) -> dict[str, Any]:
        """Makes the Pi say the wake word, pause, then the command,
        through its own speaker, right there in the van - built
        specifically so testing doesn't require being physically
        present to speak it. The mic and speaker are both already in
        the van; if they're close enough for the speaker to acoustically
        reach the mic (true for most van-sized spaces), this fires the
        exact same wake-word detection and command pipeline as actually
        saying it out loud, from anywhere with a connection.

        Deliberately speaks the wake word and the command as TWO
        separate clips with a real pause between them, not one
        continuous phrase - reported gap: a single TTS clip saying
        "computer turn the lights on" back to back has no gap in it at
        all, hitting the exact same timing problem _generate_beep_wav()
        exists to fix for a real person (recording often not actually
        started yet by the time the command audio arrives), just
        guaranteed instead of occasional. WAKE_TEST_PAUSE_SECONDS is
        deliberately generous - covers wake-word detection + the
        beep's own 0.25s + the mic handoff (close/reopen) + arecord's
        own startup, so by the time the command clip plays, real
        recording should already be underway.

        Deliberately a separate, simpler path from _handle_wake() - no
        transcription, no relay/Ron routing, just speak the two
        clips. What comes back afterward (did the wake word fire, what
        got heard, what was said) shows up the normal way, through the
        listener's own state, exactly as if it had been said aloud."""
        if not self._groq_api_key():
            raise VoiceControlUnavailableError("No Groq API key set - add one above first")
        if self._processing:
            # This doesn't call _handle_wake() itself, but its own
            # playback still uses the same exclusive mic/speaker
            # hardware _handle_wake() needs - if something else is
            # already mid-interaction, starting this too is exactly
            # the two-flows-fighting-over-one-device collision that
            # caused real symptoms live (a confirm beep getting
            # recorded as the "command", "Device or resource busy" on
            # playback). Reject clearly rather than let it happen again.
            raise VoiceControlUnavailableError("Already processing another voice interaction - wait a moment and try again")
        wake_word = self._wake_word()
        logger.info("Voice control: === manual speak-test starting: %r, pause, %r ===", wake_word, command_text)

        wake_audio = await asyncio.to_thread(self._synthesize, wake_word)
        await asyncio.to_thread(self._play_clip, wake_audio)

        logger.info("Voice control: pausing %.1fs before the command, same as a real person should", WAKE_TEST_PAUSE_SECONDS)
        await asyncio.sleep(WAKE_TEST_PAUSE_SECONDS)

        command_audio = await asyncio.to_thread(self._synthesize, command_text)
        await asyncio.to_thread(self._play_clip, command_audio)
        logger.info("Voice control: === manual speak-test finished ===")
        return self.status()

    async def _handle_wake(self) -> None:
        """Runs after the wake word fires: record -> transcribe -> act
        (relay command) or think (Ron) -> speak the result, then keeps
        listening for a follow-up (see _run_conversation_turn()) rather
        than immediately going quiet again. Every real error is caught
        and turned into a spoken apology rather than left to die
        silently in a background task - the whole point of voice
        control is not having to look at a screen to know something
        went wrong.

        Guards against a SECOND call starting while this one is still
        running - self._processing existed before this but was only
        ever used to render "THINKING..." on the status card, never
        actually checked as a lock. Real bug this caused, seen live:
        the "Test without going to the van" feature deliberately plays
        audio through the speaker for the real wake-word listener to
        pick up (that's the intended design) - but with no guard, the
        listener's own genuine trigger and the manual test's own
        _handle_wake() call both ran at once, fighting over the same
        mic and speaker. One side's confirm beep got recorded by the
        other side as if it were the spoken command ("heard 'BEEP!'" in
        the logs), and playback calls collided ("Device or resource
        busy"). A single mic+speaker can only ever serve one
        interaction at a time - there's no scenario where two SHOULD
        run concurrently, so a second call while one's in flight is
        rejected outright, not queued (queuing would mean processing a
        stale recording seconds or minutes later, out of context -
        worse than just saying no)."""
        if self._processing:
            logger.warning("Voice control: wake fired while already processing another interaction - ignoring, not queuing (see _handle_wake's own docstring for why)")
            return
        self._processing = True
        self._last_wake_at = time.time()
        # Ducks internet radio for the ENTIRE session - the original
        # wake-word turn AND every follow-up turn after it, not just one
        # exchange (those still duck/unduck too, per-turn - see
        # internet_radio_service's reentrant depth counter for why
        # nesting these is safe). The gap this closes: the actual
        # command-RECORDING window sits between the beep and the reply,
        # and radio was never paused for that part at all - confirmed
        # via a real acoustic self-test (wake word + command played
        # through the speaker, picked up by the mic) that came back
        # with Whisper hearing only "." while radio was playing. It kept
        # playing right through the person's spoken command, and the
        # mic picked up radio audio mixed with (or instead of) actual
        # speech.
        internet_radio_service.duck()
        # Fresh conversation memory every time the wake word actually
        # fires - persists across follow-up turns WITHIN this session
        # (see _run_conversation_turn()), reset here so a brand new
        # "computer, ..." doesn't inherit context from an unrelated
        # conversation minutes or hours earlier.
        self._conversation_history = []
        try:
            should_continue = await self._run_conversation_turn(is_followup=False)
            turn_count = 1
            while FOLLOWUP_CONVERSATION_ENABLED and should_continue and turn_count < MAX_FOLLOWUP_TURNS:
                should_continue = await self._run_conversation_turn(is_followup=True)
                turn_count += 1
        except Exception as e:  # noqa: BLE001 - a voice-pipeline failure must never crash the listener
            logger.warning("Voice control: error handling wake: %s", e)
            self._last_error = str(e)
        finally:
            internet_radio_service.unduck()
            self._processing = False
            self._conversation_history = []

    async def _run_conversation_turn(self, is_followup: bool) -> bool:
        """One record -> transcribe -> act (relay) or think (Ron) ->
        speak cycle. Returns True if a follow-up turn should be
        listened for next (something was actually said or done this
        turn), False if the conversation should end here (nothing was
        understood - see the two early-outs below, one for a silent
        follow-up window and one for empty transcription either way).

        is_followup=False is the original wake-word-triggered turn:
        plays the "go ahead" beep, same concurrent beep+mic-handoff fix
        as before. is_followup=True skips the beep entirely - the
        previous reply finishing IS the cue that it's the person's turn
        again, and another beep after every single exchange in an
        actual back-and-forth would get repetitive fast. Both paths use
        the same _reopen_mic_and_record() mic handoff and the same
        adaptive recording underneath, so a follow-up nobody responds
        to gives up quickly (INITIAL_SILENCE_GRACE_SECONDS) rather than
        sitting through the full window for nothing.
        """
        async def _reopen_mic_and_record() -> _RecordResult:
            # Reported symptom: arecord failing with "Device or
            # resource busy" (confirmed) whenever this ran while the
            # always-on wake-word listener's own sounddevice stream
            # was still holding the mic open, which is true by
            # definition every time this is reached via an actual
            # wake word (the listener has to be running to have
            # heard it). ALSA hardware generally allows only one
            # exclusive consumer, so arecord and the listener's own
            # stream collided.
            #
            # .stop()/.start() alone (the first attempt at this fix)
            # turned out not to be enough - PortAudio's stop() pauses
            # the audio callback but doesn't necessarily release the
            # underlying ALSA device handle, so arecord still saw it
            # as busy. Actually closing the stream (releasing the
            # hardware properly) and recreating it fresh afterward,
            # using the same construction args stashed in
            # _listen_loop() (self._stream_kwargs) so this doesn't
            # need to re-run device/model resolution for every single
            # command, is what genuinely frees the device in between.
            had_listener = self._stream is not None
            if had_listener:
                await asyncio.to_thread(self._stream.close)
                self._stream = None
            try:
                return await asyncio.to_thread(self._record_command_clip)
            finally:
                if had_listener and self._stream_kwargs is not None:
                    import sounddevice as sd

                    self._stream = sd.RawInputStream(**self._stream_kwargs)
                    await asyncio.to_thread(self._stream.start)

        if is_followup:
            record_result = await _reopen_mic_and_record()
        else:
            # Audible "go ahead, talk now" cue - see
            # _generate_beep_wav()'s own docstring. Reported symptom:
            # two commands in a row lost exactly their LAST word ("on"/
            # "off") - a strong, consistent pattern, not noise. Real
            # cause: this used to play the beep, wait for it to fully
            # finish, THEN start closing the listening stream and
            # spinning up the recorder - genuine sequential delay
            # stacked on top of the beep's own duration. Said fluidly
            # ("computer, turn the lights on"), recording often wasn't
            # actually live yet by the time the last word was spoken,
            # even having done everything right and waited for the
            # beep.
            #
            # Fix: the beep (speaker) and the mic handoff (close the
            # listener's stream, open arecord) touch completely
            # different hardware with no dependency between them, so
            # there's no real reason to do them one after another.
            # Running them concurrently means recording is already live
            # well before the beep even finishes playing, giving real
            # margin for natural speech instead of requiring it to be
            # timed around the software.
            beep = self._generate_beep_wav()
            _, record_result = await asyncio.gather(
                asyncio.to_thread(self._play_clip, beep),
                _reopen_mic_and_record(),
            )

        clip = record_result.wav_bytes

        if is_followup and not record_result.speech_detected:
            # Nothing said in the follow-up window - end the
            # conversation here rather than spend a Groq round-trip
            # confirming a near-silent clip is, in fact, silent. This
            # is the common case (most single-turn interactions have no
            # follow-up at all), so worth skipping the network call for.
            return False

        # Try offline first: physical relay control shouldn't
        # depend on the van having a working internet connection at
        # all. If Vosk's constrained grammar confidently recognises
        # a relay command, act on it immediately with zero Groq
        # calls - same relay-setting code path, same confirm beep,
        # as the Groq-matched branch below. Anything that doesn't
        # confidently match (open-ended chat, an unclear command,
        # Vosk simply not being sure) falls straight through to the
        # normal Groq Whisper transcription exactly as before - this
        # is a first attempt, never a replacement for it.
        #
        # Gated off for now (OFFLINE_RELAY_COMMANDS_ENABLED) - see
        # that constant's own comment for why.
        offline_matched = await asyncio.to_thread(self._try_offline_relay_command, clip) if OFFLINE_RELAY_COMMANDS_ENABLED else None
        _t_returned = time.monotonic()
        if offline_matched:
            # Timing instrumentation, temporary: a real, unexplained
            # ~3s gap was measured in production logs between Vosk's
            # own "heard X" line (inside _try_offline_relay_command,
            # already returned by this point) and the relay actually
            # being set - neither status() nor the DB write account
            # for it on inspection. Rather than keep guessing, log
            # exactly where the time inside this specific block goes
            # on the next real test, then remove this once it's
            # found.
            _t0 = time.monotonic()
            channel_id, _heard_direction, name = offline_matched
            # Toggle from current commanded state - deliberately
            # IGNORING which word (on/off) was actually recognised.
            # Andrew's own framing: "no matter what I say, just
            # toggle the relay" - he's standing there, can see the
            # actual light, and will just say it again if it went
            # the wrong way, exactly like flicking a real switch.
            # This also sidesteps every failure mode chased earlier
            # tonight in one move - a misheard word, a relay wired
            # the "wrong" way, an app that can't see the switch -
            # none of it matters once the action no longer depends
            # on getting on/off right in the first place.
            new_state = not self._current_commanded_on(channel_id)
            _t1 = time.monotonic()
            relay_service.set(channel_id, new_state, source="voice:ron-offline")
            _t2 = time.monotonic()
            logger.info(
                "Voice control: TIMING offline-toggle - thread_return_to_here=%.3fs, current_commanded_on=%.3fs, relay.set=%.3fs",
                _t0 - _t_returned, _t1 - _t0, _t2 - _t1,
            )
            reply = f"Toggling the {name}."
            self._last_command_text = f"[offline] toggle {name}"
            self._last_reply_text = reply
            self._last_error = None
            confirm_beep = self._generate_beep_wav(frequency_hz=1400.0, duration_s=0.12)
            await asyncio.to_thread(self._play_clip, confirm_beep)
            return True

        text = await asyncio.to_thread(self._transcribe, clip)
        self._last_command_text = text
        logger.info("Voice control: heard %r", text)

        if not text:
            return False  # nothing understood - same "end the conversation" outcome as a silent follow-up

        matched = self._match_relay_command(text)
        if matched:
            channel_id, _heard_direction, name = matched
            # Same toggle-not-absolute reasoning as the offline
            # branch above - see that comment for why.
            new_state = not self._current_commanded_on(channel_id)
            relay_service.set(channel_id, new_state, source="voice:ron")
            reply = f"Toggling the {name}."
            self._last_reply_text = reply
            self._last_error = None
            # A relay command gets its own immediate, physical
            # confirmation - the light/heater/whatever actually
            # switching - so a full spoken "Turning the lights on"
            # reply is genuinely redundant, not just slow. That was
            # several real seconds of Groq TTS synthesis + playback
            # on EVERY single relay command, for information the
            # command already gave you. A short, distinct
            # confirmation beep (higher/shorter than the "go ahead,
            # talk" cue, so the two are tellable apart) says "done"
            # instantly instead. Ron's own conversational replies
            # below still get spoken in full - there's no other way
            # to actually hear her answer.
            confirm_beep = self._generate_beep_wav(frequency_hz=1400.0, duration_s=0.12)
            await asyncio.to_thread(self._play_clip, confirm_beep)
        else:
            # Conversation memory: this turn's utterance AND Ron's
            # reply both join self._conversation_history, which
            # persists across follow-up turns within this same
            # session (reset fresh in _handle_wake() itself) - a
            # genuine "and what about tomorrow?" follow-up now has the
            # actual prior exchange to work from, rather than every
            # single turn starting from nothing. Trimmed to
            # MAX_CONVERSATION_HISTORY_MESSAGES afterward, oldest
            # first, so a long conversation doesn't grow the prompt
            # (and the Groq bill) without limit.
            self._conversation_history.append(ChatMessage(role="user", content=text))
            reply = await ai_chat_service.reply(self._conversation_history)
            self._conversation_history.append(ChatMessage(role="assistant", content=reply))
            if len(self._conversation_history) > MAX_CONVERSATION_HISTORY_MESSAGES:
                self._conversation_history = self._conversation_history[-MAX_CONVERSATION_HISTORY_MESSAGES:]
            self._last_reply_text = reply
            self._last_error = None
            audio = await asyncio.to_thread(self._synthesize, reply)
            await asyncio.to_thread(self._play_clip, audio)

        return True

    def _load_vosk_model(self):
        """Blocking - downloads the small English model on first run
        (needs internet just this once; ~40MB) if it isn't already
        cached under VOSK_MODEL_DIR. Always called via asyncio.to_thread,
        never directly on the event loop.

        Deliberately does NOT use vosk.Model(lang="en")'s built-in auto-
        download convenience. Reported symptom this fixes: the entire
        backend stuck in a crash-restart loop, not just voice control -
        vosk's own get_model_by_lang() calls sys.exit(1) directly when
        it can't resolve a model (seen here as "lang en does not
        exist", likely a transient failure reaching its own model-list
        URL). sys.exit() raises SystemExit, which is NOT an Exception
        subclass - it sailed straight past the "except Exception" this
        method's caller already had, and took the whole uvicorn process
        down with it, repeatedly. A library reaching for sys.exit()
        instead of raising is a genuinely bad citizen: it means no
        amount of exception handling in the calling code can contain
        the failure. Downloading the model directly, under this
        method's own control, means any failure here - network issue,
        bad zip, whatever - is a normal, catchable exception instead,
        and vosk.Model(model_path=...) (used below) doesn't go through
        get_model_by_lang() or its sys.exit() at all.

        Caches the loaded model on self._vosk_model after the first
        call - Vosk model loading parses a real model directory from
        disk each time, not free, and both the wake-word listener and
        the offline relay-command recognizer (_try_offline_relay_command
        below) need the same model.
        """
        if self._vosk_model is not None:
            return self._vosk_model

        import vosk
        import zipfile

        vosk.SetLogLevel(-1)  # Vosk's own C++ logging is noisy by default; the app has its own logger
        model_dir = Path(VOSK_MODEL_DIR)
        model_path = model_dir / VOSK_MODEL_NAME
        if not model_path.exists():
            model_dir.mkdir(parents=True, exist_ok=True)
            logger.info("Voice control: no cached wake-word model, downloading one now (first run only, ~40MB)")
            zip_path = model_dir / f"{VOSK_MODEL_NAME}.zip"
            try:
                with httpx.stream("GET", VOSK_MODEL_URL, timeout=120.0, follow_redirects=True) as response:
                    response.raise_for_status()
                    with open(zip_path, "wb") as f:
                        for chunk in response.iter_bytes():
                            f.write(chunk)
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(model_dir)
            finally:
                zip_path.unlink(missing_ok=True)
        self._vosk_model = vosk.Model(model_path=str(model_path))
        return self._vosk_model

    def _relay_command_grammar_words(self) -> list[str]:
        """The fixed word list for the offline relay-command recognizer
        below - Vosk's grammar mode (same mechanism already used for
        wake-word detection) constrains recognition to only these
        words/phrases, which is exactly what makes it reliable for a
        small, known vocabulary like this. Built from the LIVE relay
        names (so a rename keeps working, same as _match_relay_command's
        own singular/plural handling) plus the fixed action/connector
        words that grammar actually needs, and "[unk]" as the catch-all
        for anything else - without it, every utterance gets forced
        toward the closest listed word even when nothing close was
        actually said.
        """
        words = {"on", "off", "turn", "switch", "put", "the", "please"}
        for name in self._voice_controllable_relays():
            words.add(name)
            if name.endswith("s"):
                words.add(name[:-1])
            # Multi-word relay names ("radio / amp") need their
            # individual words in the grammar too, not just the whole
            # phrase - Vosk's grammar list matches whole list entries,
            # so "radio" alone needs to be its own entry to recognise
            # "radio off" without the "/ amp" part being spoken.
            for part in name.replace("/", " ").split():
                if part:
                    words.add(part)
        return sorted(words)

    def _try_offline_relay_command(self, wav_bytes: bytes) -> tuple[int, bool, str] | None:
        """Attempts to recognise the just-recorded command clip entirely
        offline via Vosk's grammar mode, before ever reaching for Groq.
        Returns the same (channel_id, turn_on, name) shape
        _match_relay_command() does - reuses that exact matcher on
        whatever text Vosk produces, rather than duplicating the on/off
        and adjacency logic here. Returns None (never raises) for
        anything that isn't confidently a relay command, so the caller
        can fall through to the normal Groq Whisper + Ron pipeline
        exactly as before - this is a first attempt, not a replacement.

        The point: a relay command ("lights off") is physical control
        of something in the van, and right now that only works with a
        working internet connection to Groq. Nothing about turning a
        light on or off should need to leave the vehicle.
        """
        try:
            import vosk

            model = self._load_vosk_model()
            with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
                sample_rate = wf.getframerate()
                frames = wf.readframes(wf.getnframes())

            grammar = json.dumps([*self._relay_command_grammar_words(), "[unk]"])
            recognizer = vosk.KaldiRecognizer(model, sample_rate, grammar)
            recognizer.AcceptWaveform(frames)
            result = json.loads(recognizer.FinalResult())
            text = str(result.get("text", "")).strip()
            if not text or text == "[unk]":
                return None
            logger.info("Voice control: offline (Vosk) heard %r", text)
            return self._match_relay_command(text)
        except Exception as e:  # noqa: BLE001 - this is a best-effort first attempt, any failure just falls through to Groq
            logger.debug("Voice control: offline relay-command recognition failed, falling through to Groq: %s", e)
            return None

    def _resolve_sd_input_device(self) -> int:
        """Finds the actual PortAudio device index the wake-word
        listener should use. Deliberately NOT the same value as
        self._mic_device() - that's a plain ALSA device string (e.g.
        "plughw:2,0"), correct for `arecord`/`aplay` (used elsewhere in
        this file) but not how sounddevice matches devices at all: it
        does substring-name matching against its own query_devices()
        list, never raw ALSA device-string parsing. Reported symptom:
        "No input device matching 'plughw:2,0'" - that string never
        appears in any of the descriptive names sounddevice enumerates
        (e.g. "Fifine Microphone: USB Audio (hw:2,0)"), so a literal
        match was never going to succeed no matter which ALSA-style
        string was tried.

        With only one real input device on this system right now,
        auto-detecting it (the first one with input channels) is
        simpler and more robust than requiring a second, sounddevice-
        specific config value on top of the ALSA one - one less thing
        to get wrong by hand, and it stays correct even if this exact
        device's index shifts around a replug. If the configured ALSA
        string happens to also be a substring of a device's actual
        name, that's tried first; auto-detect is the fallback covering
        the common case, not the only path.
        """
        import sounddevice as sd

        devices = sd.query_devices()
        configured = self._mic_device().strip().lower()
        if configured and configured != DEFAULT_MIC_DEVICE:
            for i, d in enumerate(devices):
                if d.get("max_input_channels", 0) > 0 and configured in str(d.get("name", "")).lower():
                    return i

        for i, d in enumerate(devices):
            if d.get("max_input_channels", 0) > 0:
                return i

        raise VoiceControlUnavailableError("No input (microphone) device found by sounddevice")

    async def _listen_loop(self) -> None:
        """The always-on wake-word listener. Runs sounddevice's audio
        callback on its own thread (that's how PortAudio works - it is
        NOT asyncio-aware), bridged into this async loop via a plain
        thread-safe queue.Queue rather than an asyncio.Queue, since the
        callback thread can't safely touch the event loop directly.

        Startup (model load, opening the mic) is wrapped in its own
        try/except - previously it wasn't, so any failure there (a slow
        first-run model download timing out, the mic device string
        being wrong, PortAudio not finding the device) just crashed this
        asyncio task silently. asyncio logs an unhandled task exception
        to the console, but nothing here was setting _last_error or
        _enabled, so the status card just sat on "STARTING…" forever
        with zero indication anything had actually gone wrong or why -
        reported symptom, not hypothetical."""
        try:
            import vosk
            import sounddevice as sd

            model = await asyncio.to_thread(self._load_vosk_model)
            wake_word = self._wake_word()
            input_device_index = self._resolve_sd_input_device()
            device_info = sd.query_devices(input_device_index)
            # Use the device's OWN native rate, not a hardcoded 16kHz -
            # reported symptom this fixes: "Invalid sample rate
            # [PaErrorCode -9997]", because this mic's hardware doesn't
            # support 16kHz directly via PortAudio's raw ALSA access
            # (unlike arecord/aplay elsewhere in this file, which go
            # through ALSA's own "plug" conversion layer and so don't
            # hit this - PortAudio here talks to the hardware device
            # directly, with no such layer of its own). Vosk's
            # KaldiRecognizer accepts (and internally resamples from)
            # whatever rate you actually tell it it's getting - so
            # rather than force a rate onto the hardware, just be
            # honest with Vosk about what rate is actually arriving.
            native_rate = int(device_info["default_samplerate"])
            # Keep chunks at roughly the same real-world duration
            # (~0.5s) regardless of the device's native rate, rather
            # than a fixed sample COUNT that would silently become a
            # different duration at a different rate.
            chunk_frames = int(native_rate * 0.5)

            # [unk] is Vosk's own convention for "recognised speech that
            # isn't one of the listed phrases" - without it, grammar mode
            # forces every utterance toward the closest listed phrase even
            # when nothing close was actually said, which would make
            # ordinary conversation nearby false-trigger constantly.
            recognizer = vosk.KaldiRecognizer(model, native_rate, json.dumps([wake_word, "[unk]"]))
            logger.info("Voice control: wake word engine ready (%r)", wake_word)

            audio_q: "queue.Queue[bytes]" = queue.Queue()

            def _callback(indata, frames, time_info, status):  # noqa: ARG001 - fixed sounddevice callback signature
                if status:
                    logger.debug("Voice control: audio stream status: %s", status)
                audio_q.put(bytes(indata))

            # Stored so _handle_wake() can fully close and recreate this
            # exact stream around each command recording, rather than
            # just pause it - see _handle_wake()'s own comment for why
            # stop()/start() alone wasn't enough.
            self._stream_kwargs = {
                "samplerate": native_rate,
                "blocksize": chunk_frames,
                "device": input_device_index,
                "channels": 1,
                "dtype": "int16",
                "callback": _callback,
            }
            self._stream = sd.RawInputStream(**self._stream_kwargs)
            self._stream.start()
            logger.info(
                "Voice control: listening on device #%d (%s) at its native %dHz",
                input_device_index, device_info["name"], native_rate,
            )
        except asyncio.CancelledError:
            raise
        except SystemExit as e:
            # Defense in depth, not hypothetical - this is exactly what
            # just took the whole backend down, repeatedly: vosk's own
            # get_model_by_lang() called sys.exit(1) directly on
            # failure, which raises SystemExit (not an Exception
            # subclass), sailing straight past the "except Exception"
            # below and killing the entire uvicorn process instead of
            # just this task. _load_vosk_model() no longer calls that
            # code path at all (see its own docstring), but a future
            # dependency doing the same thing shouldn't be able to take
            # the whole app down either - this is the safety net for
            # that, not a fix for a specific bug already handled above.
            logger.warning("Voice control: a dependency called sys.exit() during startup instead of raising: %s", e)
            self._last_error = f"Wake-word listener failed to start (a dependency called sys.exit): {e}"
            self._enabled = False
            return
        except Exception as e:  # noqa: BLE001 - a startup failure must be visible, not a silently dead task
            logger.warning("Voice control: failed to start listening: %s", e)
            self._last_error = f"Wake-word listener failed to start: {e}"
            self._enabled = False
            return

        try:
            chunks_processed = 0
            while True:
                chunk_bytes = await asyncio.to_thread(audio_q.get)
                chunks_processed += 1
                # Reported symptom: ~22s from saying the wake word to
                # the lights actually switching, far more than the
                # pipeline itself (beep + recording + Groq transcribe)
                # should ever take on its own. Real suspect: Vosk does
                # genuine continuous speech processing on every chunk,
                # real CPU work, not a lightweight check - if the Pi 2
                # can't keep up with that in real time while everything
                # else on it is also running, a backlog of unprocessed
                # audio builds up in this queue, and "wake word
                # detected" only fires once processing has finally
                # caught up to when it was actually said, not when it
                # happened. Queue depth directly measures that lag -
                # each chunk is ~0.5s of real audio, so a queue of 30
                # means the system is about 15 seconds behind real
                # time. Logged periodically (not every chunk - that
                # would flood the log for no benefit) so the trend is
                # visible, not just a single snapshot.
                if chunks_processed % 20 == 0:
                    logger.info("Voice control: still listening, %d chunks queued (~%.1fs behind real time if any)", audio_q.qsize(), audio_q.qsize() * 0.5)
                chunk_bytes = self._apply_mic_gain(chunk_bytes)
                got_final = recognizer.AcceptWaveform(chunk_bytes)
                if got_final:
                    result = json.loads(recognizer.Result())
                    heard = str(result.get("text", "")).strip()
                    if wake_word and wake_word in heard:
                        backlog = audio_q.qsize()
                        logger.info(
                            "Voice control: wake word detected (%d chunks (~%.1fs) were queued behind it - that gap is real processing lag, not the reply pipeline)",
                            backlog, backlog * 0.5,
                        )
                        while not audio_q.empty():
                            try:
                                audio_q.get_nowait()
                            except queue.Empty:
                                break
                        await self._handle_wake()
        except asyncio.CancelledError:
            raise
        except SystemExit as e:  # noqa: BLE001 - same defense-in-depth reasoning as the startup block above
            logger.warning("Voice control: a dependency called sys.exit() while listening instead of raising: %s", e)
            self._last_error = f"Wake-word listener stopped unexpectedly (a dependency called sys.exit): {e}"
            self._enabled = False
        except Exception as e:  # noqa: BLE001 - a crash mid-listening must also be visible, not silently dead
            logger.warning("Voice control: listener crashed: %s", e)
            self._last_error = f"Wake-word listener stopped unexpectedly: {e}"
            self._enabled = False
        finally:
            if self._stream:
                self._stream.stop()
                self._stream.close()
                self._stream = None
            self._stream_kwargs = None

    def start(self) -> None:
        if not self.is_configured():
            logger.info("Voice control: no Groq API key configured, not starting")
            return
        if self._task is not None:
            return
        self._enabled = True
        self._task = asyncio.create_task(self._listen_loop())

    async def stop(self) -> None:
        self._enabled = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception as e:  # noqa: BLE001 - shutdown must not raise
                logger.warning("Voice control: error during stop: %s", e)
            self._task = None


voice_control_service = VoiceControlService()
