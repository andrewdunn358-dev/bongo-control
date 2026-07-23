"""
Voice API — a one-sentence spoken summary of the van, for phone voice
shortcuts (iOS Shortcuts, Android equivalents).

Auth via the ?token= query parameter rather than a header, for the
same reason the camera endpoints allow it: a phone shortcut building a
URL can't easily attach custom headers. require_app_token already
accepts either.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from app.api.routes.auth import require_app_token
from app.services import telemetry_service
from app.services.voice_summary_service import VoiceSummaryService

router = APIRouter(prefix="/api/voice", tags=["voice"])

_service = VoiceSummaryService(telemetry_service)


@router.get("/summary", dependencies=[Depends(require_app_token)])
async def voice_summary() -> dict:
    """JSON: the sentence plus the underlying numbers, so a shortcut can
    both speak it and show a card without parsing English.
    """
    return _service.summary()


@router.get(
    "/summary.txt",
    response_class=PlainTextResponse,
    # response_model=None is required: without it FastAPI infers a
    # response model from the return annotation and advertises
    # application/json in the OpenAPI schema AND the actual response
    # header, even though response_class is PlainTextResponse. A
    # shortcut piping that into "Speak Text" would be fine either way,
    # but anything checking the content type would treat it as JSON.
    response_model=None,
    dependencies=[Depends(require_app_token)],
)
async def voice_summary_text() -> PlainTextResponse:
    """Bare text, no JSON wrapper.

    This is the one most shortcuts should use: iOS Shortcuts and its
    Android equivalents can fetch a URL and pipe the response straight
    into "Speak Text" with no parsing step at all. Returning JSON here
    would force every user to add a "Get value for key" action for no
    benefit.
    """
    # Returning the response object rather than a bare str: with a
    # `-> str` annotation FastAPI serialises the return value as JSON
    # and sends application/json regardless of response_class, which
    # would leave a shortcut speaking a quoted string."
    return PlainTextResponse(str(_service.summary()["speech"]))
