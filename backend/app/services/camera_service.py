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

logger = logging.getLogger("vanos.camera_service")

JPEG_SOI = b"\xff\xd8"  # Start Of Image marker
JPEG_EOI = b"\xff\xd9"  # End Of Image marker
BOUNDARY = b"frame"


class CameraUnavailableError(RuntimeError):
    pass


class CameraService:
    def __init__(self, device: str = "/dev/video0", input_format: str = "mjpeg", size: str = "640x480") -> None:
        self.device = device
        self.input_format = input_format
        self.size = size
        # Rotation in degrees, for a camera that's physically mounted
        # upside down or on its side. Applied server-side rather than
        # with a CSS transform in the browser so it's correct
        # everywhere the image is consumed - the web UI, a future
        # dash-mounted display, or anything else that fetches the
        # snapshot endpoint directly.
        self.rotation = self._parse_rotation(os.environ.get("CAMERA_ROTATION", "0"))

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
        """
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

        stdout, stderr = await process.communicate()
        if process.returncode != 0 or not stdout:
            raise CameraUnavailableError(f"ffmpeg snapshot failed: {stderr.decode(errors='replace')[-500:]}")
        return stdout

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
        """
        buffer = b""
        try:
            while True:
                chunk = await process.stdout.read(4096)
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
            process.kill()
            await process.wait()


camera_service = CameraService()
