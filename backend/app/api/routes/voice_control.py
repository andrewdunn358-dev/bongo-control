"""
Voice control diagnostics — status of the wake-word listener and the
last thing it heard/said, for the Settings card. See
voice_control_service.py for the actual pipeline.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.services.voice_control_service import VoiceControlUnavailableError, voice_control_service

router = APIRouter(prefix="/api/voice-control", tags=["voice-control"], dependencies=[Depends(require_app_token)])


@router.get("/status")
async def status() -> dict:
    return voice_control_service.status()


@router.post("/test")
async def test() -> dict:
    """Runs the record -> transcribe -> act/think -> speak pipeline
    once, right now - the same thing the wake word normally triggers.
    Only needs the Groq key, not a Picovoice AccessKey, so the actual
    pipeline can be proven independently of the wake-word engine."""
    try:
        return await voice_control_service.trigger_test()
    except VoiceControlUnavailableError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class SpeakTestRequest(BaseModel):
    command_text: str


@router.post("/speak-test")
async def speak_test(body: SpeakTestRequest) -> dict:
    """Makes the Pi say the wake word, pause, then this command,
    through its own speaker - built so the wake word can be tested from
    anywhere with a connection, without needing to be physically in the
    van to speak it. Speaks the wake word and the command as two
    separate clips with a real pause between them (see
    speak_test_phrase()'s docstring for why - a single continuous TTS
    phrase has no gap in it at all, which reliably breaks the same
    timing-sensitive recording window a real person's rushed speech
    only occasionally breaks). If the speaker and mic are close enough
    for this to reach the mic acoustically (true for most van-sized
    spaces), this fires the real wake-word detection and command
    pipeline exactly as if it had been said aloud."""
    try:
        return await voice_control_service.speak_test_phrase(body.command_text)
    except VoiceControlUnavailableError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
