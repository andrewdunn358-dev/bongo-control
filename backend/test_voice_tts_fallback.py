"""
Voice TTS fallback tests. Run: python backend/test_voice_tts_fallback.py

Same shape as test_battery_alarms.py - a standalone script, no pytest
dependency on the Pi. VoiceControlService talks to real hardware
(ALSA, Vosk, GPIO-adjacent relay/roof services) elsewhere in the file,
but _synthesize()'s dispatch logic doesn't touch any of that - it's
tested here by monkeypatching the instance's own provider methods,
same approach test_battery_alarms.py uses for its fakes.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import httpx  # noqa: E402
from groq import RateLimitError  # noqa: E402

from app.services.voice_control_service import (  # noqa: E402
    GroqQuotaExhaustedError,
    VoiceControlService,
    VoiceControlUnavailableError,
)

failures = []


def check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        failures.append(label)


def fresh_service(*, provider="groq", google_key="fake-google-key"):
    svc = VoiceControlService()
    svc._tts_provider = lambda: provider
    svc._google_tts_api_key = lambda: google_key
    return svc


def rate_limit_error() -> RateLimitError:
    response = httpx.Response(429, request=httpx.Request("POST", "http://test"))
    return RateLimitError("Groq TTS daily quota exceeded", response=response, body=None)


def main():
    print("=== 1. GROQ QUOTA EXHAUSTED -> FALLS BACK TO GOOGLE ===")
    svc = fresh_service(provider="groq", google_key="fake-google-key")
    svc._synthesize_groq = lambda text: (_ for _ in ()).throw(GroqQuotaExhaustedError("quota used up"))
    svc._synthesize_google = lambda text: b"GOOGLE-AUDIO"
    result = svc._synthesize("hello")
    check("falls back to Google audio instead of raising", result == b"GOOGLE-AUDIO")

    print("\n=== 2. QUOTA EXHAUSTED, NO GOOGLE KEY -> ORIGINAL ERROR SURFACES ===")
    svc = fresh_service(provider="groq", google_key="")
    svc._synthesize_groq = lambda text: (_ for _ in ()).throw(GroqQuotaExhaustedError("quota used up"))
    svc._synthesize_google = lambda text: (_ for _ in ()).throw(AssertionError("should never be called - no key to fall back with"))
    try:
        svc._synthesize("hello")
        check("raises when there's nothing to fall back to", False)
    except GroqQuotaExhaustedError:
        check("raises when there's nothing to fall back to", True)

    print("\n=== 3. A DIFFERENT GROQ FAILURE DOES NOT FALL BACK ===")
    svc = fresh_service(provider="groq", google_key="fake-google-key")
    svc._synthesize_groq = lambda text: (_ for _ in ()).throw(VoiceControlUnavailableError("bad API key"))
    svc._synthesize_google = lambda text: (_ for _ in ()).throw(AssertionError("should never be called - this isn't the quota case"))
    try:
        svc._synthesize("hello")
        check("a non-quota Groq failure still raises rather than silently switching provider", False)
    except VoiceControlUnavailableError as e:
        check("a non-quota Groq failure still raises rather than silently switching provider", not isinstance(e, GroqQuotaExhaustedError))

    print("\n=== 4. GOOGLE IS THE PROVIDER -> GROQ IS NEVER TOUCHED ===")
    svc = fresh_service(provider="google")
    svc._synthesize_groq = lambda text: (_ for _ in ()).throw(AssertionError("should never be called - provider is google"))
    svc._synthesize_google = lambda text: b"GOOGLE-AUDIO"
    result = svc._synthesize("hello")
    check("google provider goes straight to google, groq untouched", result == b"GOOGLE-AUDIO")

    print("\n=== 5. A REAL groq.RateLimitError IS TRANSLATED TO GroqQuotaExhaustedError ===")
    svc = fresh_service(provider="groq", google_key="fake-google-key")

    class FakeSpeech:
        @staticmethod
        def create(**kwargs):
            raise rate_limit_error()

    class FakeAudio:
        speech = FakeSpeech()

    class FakeGroqClient:
        audio = FakeAudio()

    svc._groq_client = lambda: FakeGroqClient()
    try:
        svc._synthesize_groq("hello")
        check("a real Groq 429 becomes GroqQuotaExhaustedError, not a raw API error", False)
    except GroqQuotaExhaustedError:
        check("a real Groq 429 becomes GroqQuotaExhaustedError, not a raw API error", True)
    except Exception as e:  # noqa: BLE001
        check(f"a real Groq 429 becomes GroqQuotaExhaustedError, not a raw API error (got {type(e).__name__})", False)

    print("\n=== 6. THAT SAME REAL 429, GOING THROUGH _synthesize(), STILL FALLS BACK ===")
    svc = fresh_service(provider="groq", google_key="fake-google-key")
    svc._groq_client = lambda: FakeGroqClient()
    svc._synthesize_google = lambda text: b"GOOGLE-AUDIO"
    result = svc._synthesize("hello")
    check("end-to-end: a real 429 from Groq's SDK still ends in a spoken Google reply, not silence", result == b"GOOGLE-AUDIO")

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All voice TTS fallback tests passed.")


if __name__ == "__main__":
    main()
