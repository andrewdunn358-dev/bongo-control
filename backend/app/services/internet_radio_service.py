"""
InternetRadioService — plays a streaming internet radio station through
the van's speaker via mpv, with pause/resume and voice-control ducking.

WHY MPV, NOT ANOTHER aplay CALL:
voice_control_service.py plays TTS replies and relay-command beeps with
a one-shot `aplay <clip>` subprocess - fine for a few seconds of audio,
wrong tool for a radio stream that might run for hours. mpv is started
once with `--idle=yes` and stays resident; everything after that (play
a different URL, pause, resume, check status) goes through its JSON IPC
socket rather than spawning a new process each time. mpv also has
built-in reconnect handling for an HTTP stream that drops - relevant on
a van's mobile connection - which a plain aplay pipe doesn't give you
for free.

SHARED SPEAKER / DUCKING:
The radio and Ron's voice both go out through the same physical
speaker (same ALSA device as voice_control_service's playback_device -
see _playback_device() below, which reads the identical config key
rather than inventing a second one). Playing both at once would just
be noise on top of noise, so voice_control_service calls duck() right
before it plays anything and unduck() right after (see _play_clip()
there). duck()/unduck() track whether THIS service was the one that
paused playback, specifically so a voice command doesn't accidentally
resume a stream the person had already paused themselves - see the
docstring on duck() for the exact logic.

HONESTY: status() reports "playing" from mpv's own actual pause
property over the IPC socket, not from whatever this service last
commanded - if mpv has died or the stream dropped and hasn't
reconnected, status() should say so, not just echo back the last
play() call. See _query_property().
"""

from __future__ import annotations

import json
import logging
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("vanos.internet_radio_service")

# AzuraCast's standard direct-stream URL pattern for a station with
# shortcode "btybar" - confirmed the server itself (radio.3bty.co.uk)
# is a real AzuraCast instance via its public player page, but the
# exact mount name wasn't independently verifiable (robots.txt blocks
# fetching /api/ automatically). Editable in Settings; if this guess is
# wrong, paste the real one from the AzuraCast admin -> station profile
# -> "Direct streaming URLs" and it takes effect on the next play().
DEFAULT_STREAM_URL = "https://radio.3bty.co.uk/listen/btybar/radio.mp3"
DEFAULT_PLAYBACK_DEVICE = "default"
DEFAULT_VOLUME = 100

IPC_SOCKET_PATH = "/tmp/vanos-internet-radio-mpv.sock"
MPV_LOG_PATH = "/tmp/vanos-internet-radio-mpv.log"
IPC_TIMEOUT_SECONDS = 3
MPV_STARTUP_TIMEOUT_SECONDS = 5


class InternetRadioUnavailableError(RuntimeError):
    pass


class InternetRadioService:
    def __init__(self) -> None:
        self._process: subprocess.Popen | None = None
        self._current_url: str | None = None
        # Set only while duck() has this service in a paused state on
        # someone else's behalf - see duck()/unduck().
        self._paused_by_duck = False
        # Depth counter, not just the boolean above - duck()/unduck()
        # are now called both around the whole wake-word-to-reply
        # window in voice_control_service AND, individually, around
        # every _play_clip() call inside that same window (the beep,
        # then separately the reply). Without counting nesting, the
        # FIRST inner unduck() (right after the "go ahead" beep) would
        # clear _paused_by_duck and resume the radio immediately - mid
        # command-recording, defeating the entire point. Only the
        # outermost duck() actually pauses; only the outermost unduck()
        # (depth back to 0) actually resumes.
        self._duck_depth = 0
        # Every public method now runs via asyncio.to_thread (API routes)
        # or is called directly from voice_control_service's own
        # to_thread call (duck/unduck) - meaning genuinely concurrent OS
        # threads can call into this service at once (a status poll
        # landing mid-play(), duck() firing while a pause() request is
        # in flight, etc). All of them touch the same mpv process/socket
        # state, so serialise with a plain lock rather than risk two
        # threads racing to spawn/kill mpv or interleave IPC commands.
        self._lock = threading.RLock()  # reentrant - duck()/unduck() call status(), which would self-deadlock a plain Lock

    # ---------------------------------------------------------- config

    @staticmethod
    def _general() -> dict[str, Any]:
        from app.services.configuration_service import configuration_service

        return configuration_service.get("general", {}) or {}

    def _configured_stream_url(self) -> str:
        return str(self._general().get("internet_radio_stream_url") or "").strip() or DEFAULT_STREAM_URL

    def _configured_volume(self) -> int:
        """Persisted across restarts (config, not just in-memory) - a
        freshly (re)spawned mpv process defaults to its own 100% unless
        told otherwise, which would silently discard whatever level was
        last chosen every time the backend redeploys."""
        raw = self._general().get("internet_radio_volume")
        try:
            level = int(raw) if raw not in (None, "") else DEFAULT_VOLUME
        except (TypeError, ValueError):
            level = DEFAULT_VOLUME
        return max(0, min(100, level))

    def _playback_device(self) -> str:
        # Deliberately the SAME config key voice_control_service reads
        # (voice_playback_device) - one setting for "which ALSA device
        # is the van's speaker", not two that could drift apart.
        return str(self._general().get("voice_playback_device") or "").strip() or DEFAULT_PLAYBACK_DEVICE

    # ------------------------------------------------------------ mpv

    def _ensure_process(self) -> None:
        """Starts mpv in idle mode if it isn't already running. A dead
        process (crashed, or never started) is detected via poll() and
        replaced - callers never need to know the difference between
        "never started" and "died earlier".
        """
        if self._process is not None and self._process.poll() is None:
            return  # already running

        Path(IPC_SOCKET_PATH).unlink(missing_ok=True)  # stale socket from a killed process
        Path(MPV_LOG_PATH).unlink(missing_ok=True)  # start each mpv process with a fresh log

        try:
            self._process = subprocess.Popen(
                [
                    "mpv",
                    "--idle=yes",
                    "--no-video",
                    "--no-terminal",
                    f"--input-ipc-server={IPC_SOCKET_PATH}",
                    f"--audio-device=alsa/{self._playback_device()}",
                    # ffmpeg-level HTTP reconnect - relevant specifically
                    # because this is a mobile connection, not just any
                    # network. Without this, one dropout kills the
                    # stream for good until someone hits play again.
                    #
                    # BUG FOUND HERE, not anywhere else: this was one
                    # combined --stream-lavf-o=... string using ':' to
                    # separate the three sub-options. mpv's --log-file
                    # finally showed the real error - ':' is for a value
                    # that's itself a list, not the separator BETWEEN
                    # key=value pairs, so ffmpeg parsed everything after
                    # the first '=' as one broken value for "reconnect"
                    # and refused to open the stream at all. Every
                    # "stuck on pause" / "nothing coming through the
                    # speaker" report this session traces back to this
                    # one typo - mpv never successfully opened a single
                    # stream, not because of the amp, the relay, or the
                    # audio device.
                    #
                    # Switched to three separate --stream-lavf-o-append
                    # flags (one option each) rather than a single
                    # comma-joined string - matches a real, confirmed-
                    # working example against a live BBC radio stream
                    # (mpv-player/mpv#13428), and avoids the same class
                    # of separator bug ever resurfacing if a future
                    # option's own value needs a comma.
                    "--stream-lavf-o-append=reconnect=1",
                    "--stream-lavf-o-append=reconnect_streamed=1",
                    "--stream-lavf-o-append=reconnect_delay_max=5",
                    # --log-file, NOT stdout piping: --no-terminal
                    # silences essentially everything mpv would
                    # otherwise print to stdout/stderr, no matter what
                    # --msg-level says - which made two earlier attempts
                    # at capturing diagnostics (piping stdout, then
                    # bumping verbosity) both quietly do nothing. mpv
                    # documents --log-file as a separate channel,
                    # unaffected by --no-terminal/--really-quiet.
                    f"--log-file={MPV_LOG_PATH}",
                    # --log-file defaults to very thorough (effectively
                    # debug/trace-level) detail with no cap of its own -
                    # exactly what was needed to actually find the real
                    # bug (the malformed reconnect option, fixed above),
                    # but left running it floods the log with routine
                    # ICY metadata refreshes every ~0.5s for as long as
                    # anything plays, which would eat real SD-card space
                    # over a genuine listening session and bury anything
                    # else worth seeing. warn+ still catches genuine
                    # connection/ALSA failures (those showed at [e]
                    # error level, well above this) without the noise.
                    "--msg-level=all=warn",
                    # Applied at spawn, not via a follow-up IPC call
                    # right after - avoids a brief moment of audio at
                    # mpv's own 100% default before a set_property call
                    # could land. See _configured_volume() - this is
                    # whatever was last actually chosen, not always 100.
                    f"--volume={self._configured_volume()}",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            threading.Thread(target=self._tail_mpv_log, args=(self._process,), daemon=True).start()
        except FileNotFoundError as e:
            raise InternetRadioUnavailableError("mpv is not installed in this image") from e

        # The IPC socket file doesn't exist the instant the process
        # spawns - mpv creates it during its own startup. Give it a
        # moment rather than racing the very first command against it.
        deadline = time.monotonic() + MPV_STARTUP_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if Path(IPC_SOCKET_PATH).exists():
                return
            time.sleep(0.1)
        raise InternetRadioUnavailableError("mpv started but its IPC socket never appeared")

    @staticmethod
    def _tail_mpv_log(process: subprocess.Popen) -> None:
        """Polls MPV_LOG_PATH for new content and forwards each new line
        to our own logger, for as long as the process is alive (plus one
        final read after it exits, to catch anything flushed at exit).
        Simple poll-and-read rather than an inotify watch - this is a
        diagnostic aid, not a hot path, and the file may not exist for
        the first moment or two while mpv starts up.
        """
        path = Path(MPV_LOG_PATH)
        position = 0
        while True:
            still_running = process.poll() is None
            try:
                if path.exists():
                    with path.open("r") as f:
                        f.seek(position)
                        for line in f:
                            stripped = line.rstrip()
                            if stripped:
                                logger.info("mpv: %s", stripped)
                        position = f.tell()
            except OSError as e:
                logger.debug("Internet radio: mpv log tail read failed (harmless, will retry): %s", e)
            if not still_running:
                return
            time.sleep(0.5)

    def _ipc_command(self, command: list[Any]) -> dict[str, Any]:
        """Sends one JSON command to mpv's IPC socket and returns its
        JSON reply. Synchronous/blocking (a local Unix socket round-
        trip, not a network call) - same "shell out and wait, don't
        overengineer it" spirit as the aplay/arecord calls elsewhere,
        just via a socket instead of a subprocess per call.

        mpv's IPC socket isn't request/reply-only: it also broadcasts
        unsolicited event lines to every connected client (start-file,
        file-loaded, playback-restart, end-file, etc.) with no request
        of ours behind them - notably including right around when a
        stream is starting/buffering, which is exactly when this app's
        status poll tends to land. Reading a single line and treating
        it as "the reply" is wrong: if an event happened to be the
        first thing on the wire, that's what gets parsed, our actual
        command's reply never gets read, and _query_property() ends up
        treating a misread event as "no data" - which surfaced as the
        radio looking permanently paused in the UI even while it was
        genuinely playing. A real reply always carries an "error" key
        (mpv's own IPC contract); an event line carries "event" instead
        and never "error" - so skip event lines and keep reading until
        a genuine reply turns up, rather than trusting whatever line
        happened to arrive first.
        """
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(IPC_TIMEOUT_SECONDS)
            sock.connect(IPC_SOCKET_PATH)
            sock.sendall((json.dumps({"command": command}) + "\n").encode())
            buffer = b""
            for _ in range(50):  # generous cap against a pathological burst of events - never expected in practice
                while b"\n" not in buffer:
                    chunk = sock.recv(4096)
                    if not chunk:
                        return {}
                    buffer += chunk
                line, _, buffer = buffer.partition(b"\n")
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "event" in parsed:
                    continue  # unsolicited broadcast, not our command's reply - keep reading
                return parsed
            raise InternetRadioUnavailableError("mpv IPC: no command reply after 50 lines - only events arrived")

    def _query_property(self, name: str) -> Any:
        try:
            reply = self._ipc_command(["get_property", name])
            return reply.get("data")
        except (OSError, json.JSONDecodeError):
            return None

    # ----------------------------------------------------------- API

    def status(self) -> dict[str, Any]:
        with self._lock:
            running = self._process is not None and self._process.poll() is None
            playing = False
            volume = self._configured_volume()
            if running:
                # mpv's own pause property is the actual truth, not
                # whatever this service last commanded - see module
                # docstring's honesty note. Same reasoning applied to
                # volume here - report what mpv actually has live, not
                # just what was last persisted, falling back to the
                # persisted value only when nothing's actually running
                # to ask.
                paused = self._query_property("pause")
                idle = self._query_property("idle-active")
                playing = paused is False and not idle
                live_volume = self._query_property("volume")
                if isinstance(live_volume, (int, float)):
                    volume = int(round(live_volume))
            return {
                "available": True,
                "running": running,
                "playing": playing,
                "stream_url": self._current_url,
                "configured_stream_url": self._configured_stream_url(),
                "volume": volume,
            }

    def set_volume(self, level: int) -> dict[str, Any]:
        """Persists the chosen level (survives a restart - see
        _configured_volume()) and applies it live via mpv's own
        `volume` IPC property if a process is actually running right
        now. If nothing's running yet, the persisted value alone is
        enough - _ensure_process() applies it via --volume at spawn
        the next time play() actually starts mpv, so there's no need
        to force a start here just to set a number nobody's listening
        to yet."""
        from app.services.configuration_service import configuration_service

        level = max(0, min(100, int(level)))
        with self._lock:
            configuration_service.set("general", {**configuration_service.get("general", {}), "internet_radio_volume": level})
            if self._process is not None and self._process.poll() is None:
                try:
                    self._ipc_command(["set_property", "volume", level])
                except OSError as e:
                    raise InternetRadioUnavailableError(f"Could not command mpv: {e}") from e
            logger.info("Internet radio: volume set to %d%%", level)
            return self.status()

    def play(self, url: str | None = None) -> dict[str, Any]:
        with self._lock:
            target_url = (url or self._configured_stream_url()).strip()
            self._ensure_process()
            try:
                self._ipc_command(["loadfile", target_url, "replace"])
                self._ipc_command(["set_property", "pause", False])
            except OSError as e:
                raise InternetRadioUnavailableError(f"Could not command mpv: {e}") from e
            self._current_url = target_url
            self._paused_by_duck = False
            logger.info("Internet radio: playing %s", target_url)
            return self.status()

    def pause(self) -> dict[str, Any]:
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                return self.status()
            try:
                self._ipc_command(["set_property", "pause", True])
            except OSError as e:
                raise InternetRadioUnavailableError(f"Could not command mpv: {e}") from e
            self._paused_by_duck = False  # an explicit user pause, not ours - see duck()
            logger.info("Internet radio: paused")
            return self.status()

    def resume(self) -> dict[str, Any]:
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                return self.play()  # nothing to resume - start fresh instead
            try:
                self._ipc_command(["set_property", "pause", False])
            except OSError as e:
                raise InternetRadioUnavailableError(f"Could not command mpv: {e}") from e
            self._paused_by_duck = False
            logger.info("Internet radio: resumed")
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._process is not None:
                try:
                    self._process.terminate()
                    self._process.wait(timeout=3)
                except Exception:  # noqa: BLE001 - best effort, next play() spawns fresh either way
                    pass
            self._process = None
            self._current_url = None
            self._paused_by_duck = False
            Path(IPC_SOCKET_PATH).unlink(missing_ok=True)
            logger.info("Internet radio: stopped")
            return self.status()

    # ---------------------------------------------------- voice ducking

    def duck(self) -> None:
        """Called by voice_control_service both around the WHOLE
        wake-word-to-reply window and, individually, around each
        _play_clip() call inside that window (the beep, then
        separately the spoken reply) - so calls nest. Reentrant via
        _duck_depth: only the OUTERMOST call actually checks/pauses;
        inner calls just increment the depth. Only pauses (and only
        remembers to resume later) if the radio was genuinely playing
        at the moment of the outermost call - if it was already paused
        or never started, this is a no-op, and unduck() won't resume
        something the person hadn't asked for. Never raises: a radio
        hiccup must never block a voice reply from playing.

        Reported bug this fixes: a self-test (wake word + command
        played through the speaker, picked up by the mic - a genuine
        acoustic round trip, not fed as text) came back with Whisper
        hearing only '.' while internet radio was playing. Ducking
        only wrapped the beep/reply playback, never the actual
        command-RECORDING window in between - so the radio kept
        playing right through the person's spoken command, and the mic
        picked up radio audio mixed with (or instead of) actual
        speech.
        """
        try:
            with self._lock:
                self._duck_depth += 1
                if self._duck_depth > 1:
                    return  # nested call - the outermost one already handled this
                if self.status().get("playing"):
                    self._ipc_command(["set_property", "pause", True])
                    self._paused_by_duck = True
        except Exception as e:  # noqa: BLE001
            logger.warning("Internet radio: duck() failed, continuing anyway: %s", e)

    def unduck(self) -> None:
        """Resumes playback, but only once every duck() call has had a
        matching unduck() (depth back to 0), and only if duck() was the
        one that paused it in the first place - see duck(). Never
        raises, same reasoning.
        """
        try:
            with self._lock:
                if self._duck_depth > 0:
                    self._duck_depth -= 1
                if self._duck_depth > 0:
                    return  # not the outermost call yet - leave paused
                if not self._paused_by_duck:
                    return  # duck() never actually paused anything
                self._ipc_command(["set_property", "pause", False])
                self._paused_by_duck = False
        except Exception as e:  # noqa: BLE001
            logger.warning("Internet radio: unduck() failed: %s", e)
            self._paused_by_duck = False  # clear it anyway - don't get stuck thinking we're still ducked


internet_radio_service = InternetRadioService()
