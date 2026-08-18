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
import time
from enum import Enum

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
# Live producer configuration.
#
# The producer exists ONLY while a Live (MJPEG) stream is active - see
# LiveProducer below for why it is deliberately not a permanently
# resident camera daemon on this hardware.
#
# INVARIANT, and the reason the whole contention fix works:
# LOCK_WAIT_TIMEOUT_SECONDS must comfortably exceed the worst-case
# producer teardown budget (TERMINATE_TIMEOUT + kill + reap, ~1-2s).
# A snapshot arriving mid-teardown blocks on the device lock and must
# still be waiting when the producer releases it. If teardown could ever
# outlast the lock wait, that snapshot would fail with the exact 503
# this design exists to remove.
# ---------------------------------------------------------------------
def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


# Shorter than FRAME_STALL_TIMEOUT_SECONDS: the producer owns the device
# for every consumer, so a stall costs more here than it does on a single
# stream and is worth catching sooner.
PRODUCER_STALL_TIMEOUT_SECONDS = _env_float("CAMERA_PRODUCER_STALL_TIMEOUT", 5.0)
# How long to wait for a polite terminate() before escalating to kill().
PRODUCER_TERMINATE_TIMEOUT_SECONDS = _env_float("CAMERA_PRODUCER_TERMINATE_TIMEOUT", 1.0)
# Restart budget. A camera that keeps stalling must stop being restarted
# in a tight loop and instead report itself failed, so the frontend's
# existing error path can surface it.
PRODUCER_MAX_RESTARTS = _env_int("CAMERA_PRODUCER_MAX_RESTARTS", 3)
PRODUCER_RESTART_WINDOW_SECONDS = _env_float("CAMERA_PRODUCER_RESTART_WINDOW", 60.0)
# How long to wait for the FIRST frame before declaring the camera
# unavailable, rather than opening a stream that contains nothing.
PRODUCER_FIRST_FRAME_TIMEOUT_SECONDS = _env_float("CAMERA_PRODUCER_FIRST_FRAME_TIMEOUT", 8.0)
# A snapshot served from the producer must be genuinely current. Matched
# to the frontend's 1.5s poll interval with headroom, so a Home tile poll
# during Live gets a frame no older than its own polling period. Beyond
# this it is an error, never a stale frame presented as live.
PRODUCER_FRAME_MAX_AGE_SECONDS = _env_float("CAMERA_PRODUCER_FRAME_MAX_AGE", 2.0)


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

    # LiveProducer spawns through this same method rather than
    # duplicating the ffmpeg arguments - one definition of how this
    # camera is opened, so a change to rotation, size or input format
    # cannot apply to one path and not the other. Named separately only
    # to make the producer's call site read honestly: it is not "opening
    # a stream for a request", it is starting the shared process.
    _spawn_stream_process = open

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


class ProducerState(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    FAILED = "failed"


class LiveProducer:
    """One ffmpeg owning /dev/video0 for the duration of Live mode, with
    every consumer reading its latest frame instead of opening the
    device themselves.

    DELIBERATELY NOT a permanently resident camera daemon. This webcam
    has a documented USB stability problem - a continuously-held
    connection is what caused it, which is why capture_snapshot() does a
    brief open-grab-close and why that is not being changed. The
    producer exists only while a Live stream is active and is destroyed
    when the last subscriber leaves, so normal snapshot polling keeps
    the known-good behaviour and the device is held for the shortest
    time that still solves contention.

    DEVICE OWNERSHIP is the whole point. The producer acquires
    CameraService._device_lock for its entire lifetime and releases it
    only after its ffmpeg has been definitively reaped. That is what
    makes the teardown race impossible rather than merely unlikely: a
    snapshot arriving while the producer is stopping blocks on the same
    lock capture_snapshot() already uses, and proceeds once the device
    is genuinely free. No new endpoint, no "stopping" flag, no
    frontend-side delay - the synchronisation is the lock.

    This only works because the producer is Live-scoped. Holding the
    lock across a whole stream would starve the Home screen's camera
    tile - except that while the producer runs, snapshots are served
    from its latest frame and never touch the device at all. The only
    thing that ever blocks is a snapshot during teardown, which is
    exactly the thing that should wait.
    """

    def __init__(self, service: CameraService) -> None:
        self._service = service
        self.state = ProducerState.STOPPED
        self._process: asyncio.subprocess.Process | None = None
        self._pump_task: asyncio.Task | None = None
        self._subscribers: set[int] = set()
        self._next_subscriber_id = 0
        self._latest_frame: bytes | None = None
        self._latest_frame_at: float = 0.0
        self._frame_event = asyncio.Event()
        # Serialises start/stop so concurrent Live requests converge on
        # ONE producer. Without it, two requests arriving together both
        # see state == STOPPED and both spawn ffmpeg against a device
        # only one can have.
        self._lifecycle_lock = asyncio.Lock()
        self._holds_device_lock = False
        self._restart_times: list[float] = []
        self._last_error: str | None = None

    # ---- consumer-facing API -------------------------------------

    @property
    def active(self) -> bool:
        return self.state in (ProducerState.STARTING, ProducerState.RUNNING)

    def latest_frame(self) -> tuple[bytes, float] | None:
        """The most recent frame and its age, or None if there isn't a
        fresh one. Never returns a stale frame - a caller cannot
        accidentally present old footage as live."""
        if self._latest_frame is None:
            return None
        age = time.monotonic() - self._latest_frame_at
        if age > PRODUCER_FRAME_MAX_AGE_SECONDS:
            return None
        return self._latest_frame, age

    async def subscribe(self) -> int:
        """Registers a consumer, starting the producer if needed, and
        waits for a real first frame before returning. Raises rather
        than handing back a stream that contains nothing."""
        async with self._lifecycle_lock:
            if self.state == ProducerState.FAILED:
                # An explicit new Live request is allowed to reset the
                # budget and try again - the failure was recorded to
                # stop a tight restart loop, not to disable the camera
                # until the backend restarts.
                self._restart_times.clear()
                self.state = ProducerState.STOPPED
            sub_id = self._next_subscriber_id
            self._next_subscriber_id += 1
            self._subscribers.add(sub_id)
            if self.state == ProducerState.STOPPED:
                await self._start_locked()

        try:
            await self._await_first_frame()
        except Exception:
            await self.unsubscribe(sub_id)
            raise
        return sub_id

    async def unsubscribe(self, sub_id: int) -> None:
        """Removes a consumer and stops the producer if it was the last
        one. No meaningful idle linger, deliberately: given this
        camera's USB history the device should be held for as little
        time as possible, so churn is the cheaper risk."""
        async with self._lifecycle_lock:
            self._subscribers.discard(sub_id)
            if not self._subscribers and self.state != ProducerState.STOPPED:
                await self._stop_locked()

    async def frames(self, sub_id: int):
        """Yields multipart-wrapped JPEG chunks for one subscriber.

        LATEST-FRAME semantics, never a per-subscriber queue: this is a
        live camera, so a slow client should skip ahead rather than
        accumulate a backlog that costs memory and shows old footage.
        """
        last_sent_at = 0.0
        try:
            while sub_id in self._subscribers and self.active:
                if self._latest_frame is not None and self._latest_frame_at > last_sent_at:
                    frame = self._latest_frame
                    last_sent_at = self._latest_frame_at
                    yield (
                        b"--" + BOUNDARY + b"\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
                    )
                    continue
                try:
                    await asyncio.wait_for(self._frame_event.wait(), timeout=PRODUCER_STALL_TIMEOUT_SECONDS)
                except asyncio.TimeoutError:
                    # The pump's own watchdog handles restart/failure;
                    # this just ends the response so the browser's
                    # error path fires instead of freezing on a frame.
                    break
                self._frame_event.clear()
        finally:
            # Always runs, including on an unexpected browser disconnect
            # or a revoked token mid-stream - that is what guarantees the
            # producer eventually stops and the device is released.
            await self.unsubscribe(sub_id)

    # ---- lifecycle (callers must hold _lifecycle_lock) ------------

    async def _start_locked(self) -> None:
        self.state = ProducerState.STARTING
        self._latest_frame = None
        self._latest_frame_at = 0.0
        self._last_error = None
        try:
            await asyncio.wait_for(
                self._service._device_lock.acquire(), timeout=LOCK_WAIT_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError as e:
            self.state = ProducerState.STOPPED
            raise CameraUnavailableError(
                f"Camera busy with another request for over {LOCK_WAIT_TIMEOUT_SECONDS}s - try again shortly"
            ) from e
        self._holds_device_lock = True
        try:
            self._process = await self._service._spawn_stream_process()
        except Exception:
            await self._release_device()
            self.state = ProducerState.STOPPED
            raise
        self._pump_task = asyncio.create_task(self._pump())
        self.state = ProducerState.RUNNING

    async def _stop_locked(self, failed: bool = False) -> None:
        if self._pump_task:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._pump_task = None
        await self._reap_process()
        await self._release_device()
        self.state = ProducerState.FAILED if failed else ProducerState.STOPPED
        self._latest_frame = None
        self._latest_frame_at = 0.0
        # Wake anything still waiting so it sees the state change rather
        # than sitting until its own timeout.
        self._frame_event.set()

    async def _reap_process(self) -> None:
        """terminate -> bounded wait -> kill -> wait. The device is NOT
        free until this returns, which is why the lock is released only
        afterwards."""
        proc = self._process
        self._process = None
        if proc is None:
            return
        try:
            proc.terminate()
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=PRODUCER_TERMINATE_TIMEOUT_SECONDS)
            return
        except asyncio.TimeoutError:
            pass
        try:
            proc.kill()
            await proc.wait()
        except ProcessLookupError:
            pass

    async def _release_device(self) -> None:
        if self._holds_device_lock:
            self._holds_device_lock = False
            try:
                self._service._device_lock.release()
            except RuntimeError:
                pass

    async def _await_first_frame(self) -> None:
        deadline = time.monotonic() + PRODUCER_FIRST_FRAME_TIMEOUT_SECONDS
        while self._latest_frame is None:
            if self.state == ProducerState.FAILED or self.state == ProducerState.STOPPED:
                raise CameraUnavailableError(self._last_error or "Camera producer stopped before first frame")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CameraUnavailableError(
                    f"No frame from the camera within {PRODUCER_FIRST_FRAME_TIMEOUT_SECONDS}s"
                )
            try:
                await asyncio.wait_for(self._frame_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                raise CameraUnavailableError(
                    f"No frame from the camera within {PRODUCER_FIRST_FRAME_TIMEOUT_SECONDS}s"
                ) from None
            self._frame_event.clear()

    # ---- the pump ------------------------------------------------

    async def _pump(self) -> None:
        """Reads ffmpeg's MJPEG byte stream, splits it on JPEG markers
        and publishes the latest frame.

        Health is judged on FRAMES ARRIVING, not on ffmpeg still being
        alive - this camera's characteristic failure is a process that
        stays up and quietly stops producing, so process liveness says
        nothing useful."""
        buffer = b""
        try:
            while True:
                proc = self._process
                if proc is None or proc.stdout is None:
                    return
                try:
                    chunk = await asyncio.wait_for(
                        proc.stdout.read(4096), timeout=PRODUCER_STALL_TIMEOUT_SECONDS
                    )
                except asyncio.TimeoutError:
                    await self._handle_failure(
                        f"No frame data for {PRODUCER_STALL_TIMEOUT_SECONDS}s - camera stalled"
                    )
                    return
                if not chunk:
                    await self._handle_failure("ffmpeg exited unexpectedly")
                    return
                buffer += chunk
                while True:
                    start = buffer.find(JPEG_SOI)
                    if start == -1:
                        buffer = b""
                        break
                    end = buffer.find(JPEG_EOI, start)
                    if end == -1:
                        buffer = buffer[start:]
                        break
                    self._latest_frame = buffer[start : end + 2]
                    self._latest_frame_at = time.monotonic()
                    buffer = buffer[end + 2 :]
                    self._frame_event.set()
        except asyncio.CancelledError:
            raise

    async def _handle_failure(self, reason: str) -> None:
        """Restart on stall, but only while someone is still watching and
        only within the restart budget."""
        logger.warning("Camera producer: %s", reason)
        self._last_error = reason
        now = time.monotonic()
        self._restart_times = [t for t in self._restart_times if now - t < PRODUCER_RESTART_WINDOW_SECONDS]

        async with self._lifecycle_lock:
            if not self._subscribers:
                # Nobody watching - do not restart just to hold the
                # device open for no one.
                await self._stop_locked()
                return
            if len(self._restart_times) >= PRODUCER_MAX_RESTARTS:
                logger.error(
                    "Camera producer: %d restarts within %.0fs - marking FAILED rather than looping",
                    len(self._restart_times), PRODUCER_RESTART_WINDOW_SECONDS,
                )
                await self._stop_locked(failed=True)
                return
            self._restart_times.append(now)
            self._pump_task = None  # we ARE the pump task; don't cancel ourselves
            await self._reap_process()
            await self._release_device()
            self.state = ProducerState.STOPPED
            try:
                await self._start_locked()
            except Exception as e:  # noqa: BLE001
                self._last_error = str(e)
                self.state = ProducerState.FAILED
                self._frame_event.set()

    async def shutdown(self) -> None:
        """Called from the app's shutdown hook. Must leave no ffmpeg
        holding the device behind."""
        async with self._lifecycle_lock:
            self._subscribers.clear()
            if self.state != ProducerState.STOPPED:
                await self._stop_locked()


camera_service = CameraService()
live_producer = LiveProducer(camera_service)
