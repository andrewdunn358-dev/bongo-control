"""
CameraService — MJPEG-over-HTTP streaming directly from a USB webcam
attached to the same Pi this backend runs on.

Deliberately NOT using go2rtc/WebRTC/MSE here (that stack was built
for the earlier Tapo networked-camera setup, and stayed in
docker-compose.yml as an optional profile for if a networked camera
gets added back later - see docker/go2rtc.yaml). All of that
complexity - WebRTC signaling, MSE fallback, base_path reverse-proxy
config - exists to solve "get video across a network and through
protocol negotiation." A webcam physically plugged into this same
Pi has no network hop to solve for at all. MJPEG-over-HTTP is just an
ordinary chunked HTTP response (a live sequence of JPEG images), so it
rides on exactly the same plumbing every other endpoint in this app
already uses - no separate reverse-proxy config, no mixed-content
concerns, works identically over plain HTTP and through the Cloudflare
Tunnel's HTTPS with zero special-casing.

Known limitation: V4L2 devices generally only support one consumer at
a time. This spawns a fresh ffmpeg process per request rather than a
shared broadcaster - fine for one viewer at a time (the realistic case
here), but a second simultaneous viewer will fail to open the device
rather than share the existing stream. Worth revisiting if that
actually becomes a problem in practice.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

logger = logging.getLogger("vanos.camera_service")

JPEG_SOI = b"\xff\xd8"  # Start Of Image marker
JPEG_EOI = b"\xff\xd9"  # End Of Image marker
BOUNDARY = b"frame"

# A single-frame grab should take well under a second; give it generous
# headroom for a slow USB cam, but never allow an unbounded hang.
SNAPSHOT_TIMEOUT_SECONDS = 8.0

# The continuous Live stream has no per-frame timeout equivalent, and
# needed one - see mjpeg_frames() for the reported symptom this fixes.
# Generous relative to a real frame interval (well under a second at
# any normal framerate) but short enough that a genuine stall recovers
# in a reasonable time rather than sitting on a black frame for minutes.
FRAME_STALL_TIMEOUT_SECONDS = 10.0

# How long a caller will wait to ACQUIRE the device lock before giving
# up - separate from SNAPSHOT_TIMEOUT_SECONDS, which only bounds what
# happens once a caller already holds it. Without this, a queue of
# waiting requests has no ceiling on total wait at all - see
# capture_snapshot() for the real failure this caused (a device 4+
# minutes / a Cloudflare 504 away, not the fast local "device busy"
# this was meant to smooth over).
LOCK_WAIT_TIMEOUT_SECONDS = 4.0

# ---------------------------------------------------------------------
# Optional external streamer (uStreamer).
#
# The problem this solves, measured on this Pi: a fresh open of
# /dev/video0 costs ~4.1s - identical with ffmpeg and fswebcam, and
# only ~0.5s of it CPU. The rest is USB open, format negotiation and
# auto-exposure settling. Two consequences we chased for days:
#
#   - polling could never be faster than the device could answer, so
#     requests queued and timed out
#   - every frame is the camera's FIRST frame, taken before
#     auto-exposure has settled, which is why snapshots come out dark
#     while a bare capture that runs for a moment looks correct
#
# Neither is fixable while the device is reopened per frame, and no
# capture tool avoids it. uStreamer holds the device open, so exposure
# settles once and a snapshot becomes "hand me the current frame".
#
# Set CAMERA_USTREAMER_URL to enable. Left unset, everything below
# behaves exactly as before - this is additive, and the ffmpeg path
# stays as the fallback rather than being deleted, because it is what
# works today and uStreamer is unproven on this hardware.
# ---------------------------------------------------------------------
USTREAMER_URL = (os.environ.get("CAMERA_USTREAMER_URL") or "").rstrip("/")
USTREAMER_TIMEOUT_SECONDS = 5.0


class CameraUnavailableError(RuntimeError):
    pass


class CameraService:
    def __init__(self, device: str | None = None, input_format: str = "mjpeg", size: str = "640x480") -> None:
        # WEBCAM_DEVICE is set by docker-compose (see the `devices:`
        # section - it's what actually gets bind-mounted into the
        # container) but was never actually READ here until now - this
        # was hardcoded to /dev/video0 regardless, which only ever
        # "worked" by coincidence when WEBCAM_DEVICE also happened to
        # be /dev/video0. Pointing it at a stable /dev/v4l/by-id/...
        # path (so the camera keeps working regardless of which USB
        # port it's plugged into) surfaced the gap immediately.
        self.device = device or os.environ.get("WEBCAM_DEVICE", "/dev/video0")
        self.input_format = input_format
        # Stream framerate, configurable so it can be tuned on the real
        # Pi without a rebuild. Applies to the MJPEG stream only -
        # snapshots grab a single frame and are unaffected.
        try:
            self.stream_fps = int(os.environ.get("CAMERA_STREAM_FPS", "") or 5)
        except (TypeError, ValueError):
            self.stream_fps = 5
        self.size = size
        # Rotation in degrees, for a camera that's physically mounted
        # upside down or on its side. Applied server-side rather than
        # with a CSS transform in the browser so it's correct
        # everywhere the image is consumed - the web UI, a future
        # dash-mounted display, or anything else that fetches the
        # snapshot endpoint directly.
        self.rotation = self._parse_rotation(os.environ.get("CAMERA_ROTATION", "0"))
        # V4L2 devices only allow one process to have them open at a
        # time (see the module docstring's "known limitation" note -
        # this is that limitation actually being hit in practice:
        # reported symptom was one device (PC) polling fine, a second
        # device (phone) unable to open the same snapshot stream
        # alongside it). Each snapshot is still a brief, independent
        # open-grab-close (not a continuously-held connection - that
        # approach is what caused the Live-mode USB stability problem
        # this camera already had, so it's deliberately not being
        # reintroduced here). This lock just serialises those brief
        # opens instead of letting two land at the same instant and
        # collide - a second viewer's request queues for a fraction of
        # a second rather than failing outright.
        self._device_lock = asyncio.Lock()

    @staticmethod
    def _parse_rotation(value: str) -> int:
        try:
            degrees = int(value)
        except ValueError:
            logger.warning("Invalid CAMERA_ROTATION %r - ignoring, using 0", value)
            return 0
        if degrees not in (0, 90, 180, 270):
            logger.warning("CAMERA_ROTATION must be 0, 90, 180 or 270 (got %s) - ignoring, using 0", degrees)
            return 0
        return degrees

    def _rotation_args(self) -> list[str]:
        """ffmpeg filter args for the configured rotation, or none at
        all when rotation is 0 - passing an identity filter would make
        ffmpeg decode and re-encode the frame for no reason, which
        matters on a Pi.
        """
        if self.rotation == 0:
            return []
        # transpose=1 is 90 clockwise, =2 is 90 counter-clockwise.
        # 180 is two transposes, but hflip+vflip is cheaper and avoids
        # the dimension swap that two transposes would imply.
        filters = {
            90: "transpose=1",
            180: "hflip,vflip",
            270: "transpose=2",
        }
        return ["-vf", filters[self.rotation]]

    @property
    def ustreamer_enabled(self) -> bool:
        return bool(USTREAMER_URL)

    async def ustreamer_status(self) -> dict:
        """Is uStreamer actually answering? Used by /api/camera/status so
        the source in use is visible rather than guessed at."""
        if not USTREAMER_URL:
            return {"configured": False, "reachable": False, "url": None}
        try:
            async with httpx.AsyncClient(timeout=USTREAMER_TIMEOUT_SECONDS) as client:
                response = await client.get(f"{USTREAMER_URL}/snapshot")
            ok = response.status_code == 200 and response.content.startswith(JPEG_SOI)
            return {
                "configured": True,
                "reachable": ok,
                "url": USTREAMER_URL,
                "detail": None if ok else f"HTTP {response.status_code}",
            }
        except Exception as e:  # noqa: BLE001
            return {"configured": True, "reachable": False, "url": USTREAMER_URL, "detail": str(e)}

    async def _snapshot_via_ustreamer(self) -> bytes:
        """Fetch the current frame from uStreamer over HTTP.

        Deliberately strict about what counts as success: a non-200, an
        empty body, or something that is not a JPEG all raise, so the
        caller falls back to ffmpeg rather than handing a broken image
        to the UI. Checking the JPEG magic bytes matters because a
        misconfigured uStreamer will happily return an HTML error page
        with a 200.
        """
        url = f"{USTREAMER_URL}/snapshot"
        async with httpx.AsyncClient(timeout=USTREAMER_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
        if response.status_code != 200:
            raise CameraUnavailableError(f"uStreamer returned {response.status_code}")
        data = response.content
        if not data:
            raise CameraUnavailableError("uStreamer returned an empty body")
        if not data.startswith(JPEG_SOI):
            raise CameraUnavailableError("uStreamer returned something that is not a JPEG")
        return data

    async def capture_snapshot(self) -> bytes:
        """Captures exactly one JPEG frame and returns its raw bytes -
        the basis for an auto-refreshing snapshot approach (a plain
        <img> re-fetched on a timer) rather than a continuous
        multipart stream. Deliberately the fallback here:
        multipart/x-mixed-replace has a long, genuinely inconsistent
        history across browsers and platforms (Chrome dropped support
        for it as a top-level navigation in 2013, mobile Safari and
        some Android WebView contexts have had their own gaps) - a
        single ordinary image fetch, repeated on an interval, has
        nothing platform-specific left to go wrong. Costs smoothness
        (a slideshow, not video) for universal reliability.

        Serialised via self._device_lock - see __init__ for why. Two
        viewers polling independently means two callers can land here
        within the same instant; without the lock, both would try to
        open the V4L2 device at once and one would fail outright
        ("device busy" from ffmpeg). With it, the second caller just
        waits the fraction of a second the first's capture takes.

        The wait to ACQUIRE the lock is itself bounded
        (LOCK_WAIT_TIMEOUT_SECONDS), separately from
        SNAPSHOT_TIMEOUT_SECONDS below which only bounds what happens
        once a caller is already holding it. Reported symptom this
        fixes: PC polling smoothly, phone getting a real 504 from
        Cloudflare's own edge - not an auth problem, a queue-depth
        problem. If the camera hits one of its known rough patches
        (the USB stability issue this whole camera has had) and the
        PC keeps firing a new poll every 1.5s regardless of whether
        earlier ones have even resolved yet, requests can queue up
        faster than 8s-bounded captures drain - and without a cap on
        the wait itself, a second device's request can sit behind that
        pile-up for however long it takes to clear, easily outlasting
        any reasonable HTTP timeout. Failing fast here instead means
        the frontend's own consecutive-failure/error-surfacing (just
        added) sees a real, quick 503 to report, not Cloudflare's
        opaque 504 after minutes of silence.
        """
        # uStreamer path: it already holds the device and has a current,
        # correctly-exposed frame, so there is nothing to open, no lock
        # to take and no queue to join. Falls through to ffmpeg on any
        # failure rather than erroring - if uStreamer is stopped or
        # wedged, the camera should degrade to the slow-but-proven path,
        # not go dark.
        if USTREAMER_URL:
            try:
                return await self._snapshot_via_ustreamer()
            except Exception as e:  # noqa: BLE001
                logger.warning("uStreamer snapshot failed, falling back to ffmpeg: %s", e)

        try:
            await asyncio.wait_for(self._device_lock.acquire(), timeout=LOCK_WAIT_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as e:
            raise CameraUnavailableError(
                f"Camera busy with another request for over {LOCK_WAIT_TIMEOUT_SECONDS}s - try again shortly"
            ) from e
        try:
            try:
                process = await asyncio.create_subprocess_exec(
                    "ffmpeg",
                    "-f",
                    "v4l2",
                    "-input_format",
                    self.input_format,
                    "-video_size",
                    self.size,
                    "-i",
                    self.device,
                    *self._rotation_args(),
                    "-frames:v",
                    "1",
                    "-f",
                    "image2",
                    "-",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except FileNotFoundError as e:
                raise CameraUnavailableError("ffmpeg not found in this container") from e

            # Bound the wait: if ffmpeg opens the device but never produces a
            # frame (a flaky USB cam), communicate() would otherwise await
            # forever and the request would hang, holding both the device
            # AND the lock above - kill on timeout so a wedged capture can't
            # block every other viewer indefinitely behind it.
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=SNAPSHOT_TIMEOUT_SECONDS)
            except asyncio.TimeoutError as e:
                try:
                    process.kill()
                    await process.wait()
                except ProcessLookupError:
                    pass
                raise CameraUnavailableError(
                    f"ffmpeg snapshot timed out after {SNAPSHOT_TIMEOUT_SECONDS}s — device busy or not responding"
                ) from e
            if process.returncode != 0 or not stdout:
                raise CameraUnavailableError(f"ffmpeg snapshot failed: {stderr.decode(errors='replace')[-500:]}")
            return stdout
        finally:
            self._device_lock.release()

    async def open(self) -> asyncio.subprocess.Process:
        """Starts ffmpeg and confirms the process itself launched.
        Separated from mjpeg_frames() deliberately: that's an async
        generator, which doesn't execute any code until something
        actually iterates it - meaning a try/except around calling it
        would never catch anything, since by the time iteration starts
        (inside Starlette's response-sending machinery) it's too late
        to cleanly convert a failure into an HTTP error response.
        Awaiting this directly in the route, before constructing the
        StreamingResponse, is what actually allows that.

        Note: this only confirms the *process* started, not that ffmpeg
        successfully opened the actual device - a wrong device path or
        permissions issue still won't surface until moments later, once
        ffmpeg itself gives up and exits (which mjpeg_frames() below
        does detect and raise on, just after streaming has already
        begun rather than before).
        """
        try:
            return await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-f",
                "v4l2",
                "-input_format",
                self.input_format,
                "-video_size",
                self.size,
                "-i",
                self.device,
                *self._rotation_args(),
                # Output framerate cap. The camera runs at 30fps and each
                # frame measured ~18KB on this hardware, which is roughly
                # 1.9 GB per HOUR of viewing and a continuous ffmpeg load
                # on a Pi 2 that already has a voice pipeline competing
                # for CPU and a 0.2s roof watchdog on the same event
                # loop.
                #
                # 5fps is ~320 MB/hour instead, and is still comfortably
                # smooth for what this stream is actually for: focusing
                # the lens by hand, and looking in on the van. The thing
                # that made 1.5s snapshot polling useless for focusing
                # was the wait between frames, and 200ms is far below
                # the point where that matters.
                "-r",
                str(self.stream_fps),
                "-f",
                "mjpeg",
                "-q:v",
                "5",
                "pipe:1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as e:
            raise CameraUnavailableError("ffmpeg not found in this container") from e

    async def mjpeg_frames(self, process: asyncio.subprocess.Process):
        """Yields already-multipart-wrapped JPEG frame chunks, ready to
        write directly to an HTTP response body, from an already-started
        ffmpeg process (see open()). Splits ffmpeg's raw MJPEG byte
        stream on JPEG start/end markers rather than trusting any
        particular read-buffer size to align with frame boundaries - a
        single `read()` call has no reason to land exactly on a frame edge.

        Bounded reads, unlike the original version of this method.
        Reported symptom: Live view working fine, then going to a
        black frame after a minute or two and staying that way. The
        bug: `read()` had no timeout, so a webcam that stalls mid-
        stream (still running, just stopped producing frames - a real
        USB webcam failure mode) left this awaiting forever. ffmpeg
        exiting cleanly was handled (the `if not chunk` branch below);
        ffmpeg silently hanging was not, and hanging is exactly the
        harder, more common failure. A stalled read now raises after
        FRAME_STALL_TIMEOUT_SECONDS, which - critically - actually
        closes the HTTP response the browser is reading, so the <img>
        element's onerror fires and the frontend's already-built
        Live-to-Polling fallback (Camera.tsx) actually triggers,
        instead of the tab just sitting on a frozen black frame with
        no error ever surfacing.
        """
        buffer = b""
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(process.stdout.read(4096), timeout=FRAME_STALL_TIMEOUT_SECONDS)
                except asyncio.TimeoutError as e:
                    raise CameraUnavailableError(
                        f"No frame data for {FRAME_STALL_TIMEOUT_SECONDS}s - camera stream stalled"
                    ) from e
                if not chunk:
                    stderr = await process.stderr.read()
                    raise CameraUnavailableError(f"ffmpeg exited unexpectedly: {stderr.decode(errors='replace')[-500:]}")
                buffer += chunk

                while True:
                    start = buffer.find(JPEG_SOI)
                    if start == -1:
                        buffer = b""  # no frame start yet, drop noise
                        break
                    end = buffer.find(JPEG_EOI, start)
                    if end == -1:
                        buffer = buffer[start:]  # keep partial frame, wait for more data
                        break

                    frame = buffer[start : end + 2]
                    buffer = buffer[end + 2 :]
                    yield (
                        b"--" + BOUNDARY + b"\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
                    )
        finally:
            # ffmpeg may already have exited on its own by the time we
            # get here (e.g. the device vanished mid-stream, as in the
            # "Cannot open video device: No such device or address"
            # case this is fixing) - kill() on an already-dead process
            # raises ProcessLookupError, which was going unhandled and
            # showing up as a noisy traceback in the logs on top of the
            # real error. Match the same pattern already used in
            # capture_snapshot()'s timeout handling below.
            try:
                process.kill()
                await process.wait()
            except ProcessLookupError:
                pass


camera_service = CameraService()
