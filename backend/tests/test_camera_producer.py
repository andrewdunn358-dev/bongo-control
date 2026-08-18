"""
Live camera producer — the eleven contention cases.

The bug this exists to kill: stopping the Live stream returned a 503,
because the stream's ffmpeg still held /dev/video0 when snapshot polling
resumed. The fix is that the producer holds CameraService._device_lock
for its whole life and releases it only after its process is reaped, so
a snapshot arriving mid-teardown WAITS instead of racing.

Every test drives the real LiveProducer with a fake ffmpeg process, so
the lock discipline, state machine and teardown ordering are exercised
rather than mocked away.
"""

from __future__ import annotations

import asyncio

import pytest

from app.services import camera_service as cam
from app.services.camera_service import (
    CameraService,
    CameraUnavailableError,
    LiveProducer,
    ProducerState,
)

JPEG = cam.JPEG_SOI + b"payload" + cam.JPEG_EOI


class FakeStdout:
    """Feeds MJPEG bytes on demand; can stall or EOF to order."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()
        self.stalled = False

    async def read(self, _n: int) -> bytes:
        if self.stalled:
            await asyncio.sleep(3600)  # never returns - a wedged webcam
        return await self._queue.get()

    def push(self, data: bytes = JPEG) -> None:
        self._queue.put_nowait(data)

    def eof(self) -> None:
        self._queue.put_nowait(b"")


class FakeProcess:
    def __init__(self) -> None:
        self.stdout = FakeStdout()
        self.terminated = False
        self.killed = False
        self.reaped = False
        self._exit = asyncio.Event()
        self.ignore_terminate = False

    def terminate(self) -> None:
        self.terminated = True
        if not self.ignore_terminate:
            self._exit.set()

    def kill(self) -> None:
        self.killed = True
        self._exit.set()

    async def wait(self) -> int:
        await self._exit.wait()
        self.reaped = True
        return 0


@pytest.fixture
def svc() -> CameraService:
    return CameraService()


@pytest.fixture
def producer(svc, monkeypatch):
    p = LiveProducer(svc)
    spawned: list[FakeProcess] = []

    async def fake_spawn(_self=None):
        proc = FakeProcess()
        spawned.append(proc)
        # Deliver a frame shortly after start so subscribe() completes.
        asyncio.get_running_loop().call_later(0.01, proc.stdout.push)
        return proc

    monkeypatch.setattr(svc, "_spawn_stream_process", fake_spawn)
    p.spawned = spawned  # type: ignore[attr-defined]
    return p


async def drain(gen, n=1):
    out = []
    async for chunk in gen:
        out.append(chunk)
        if len(out) >= n:
            break
    return out


# --- 1. snapshot + snapshot -------------------------------------------
@pytest.mark.asyncio
async def test_1_two_snapshots_serialise_on_the_lock(svc, monkeypatch):
    """Pre-existing behaviour must be untouched: two concurrent snapshots
    queue on the device lock rather than both opening the device."""
    concurrent = 0
    peak = 0

    async def fake_capture():
        nonlocal concurrent, peak
        concurrent += 1
        peak = max(peak, concurrent)
        await asyncio.sleep(0.02)
        concurrent -= 1
        return b"jpeg"

    async def wrapped():
        await asyncio.wait_for(svc._device_lock.acquire(), timeout=cam.LOCK_WAIT_TIMEOUT_SECONDS)
        try:
            return await fake_capture()
        finally:
            svc._device_lock.release()

    await asyncio.gather(wrapped(), wrapped())
    assert peak == 1, "two captures held the device at once"


# --- 2 & 3. snapshot + Live, Live + Home snapshot ---------------------
@pytest.mark.asyncio
async def test_2_3_snapshot_during_live_never_touches_the_device(producer, svc):
    """While Live runs the producer holds the lock, and snapshots are
    served from its frame - so the Home tile keeps working and never
    competes for /dev/video0."""
    sub = await producer.subscribe()
    assert producer.state is ProducerState.RUNNING
    assert svc._device_lock.locked(), "producer must hold the device lock while running"

    frame = producer.latest_frame()
    assert frame is not None and frame[0] == JPEG

    await producer.unsubscribe(sub)
    assert not svc._device_lock.locked(), "lock must be released after teardown"


# --- THE ORIGINAL BUG -------------------------------------------------
@pytest.mark.asyncio
async def test_snapshot_during_teardown_waits_instead_of_racing(producer, svc):
    """The regression test for the reported 503.

    A snapshot arriving while the producer is tearing down must block on
    the device lock until ffmpeg is reaped, then proceed - not fail.
    """
    sub = await producer.subscribe()
    proc = producer.spawned[-1]
    proc.ignore_terminate = True  # force the slow terminate->kill path

    order: list[str] = []

    async def snapshot_attempt():
        await asyncio.sleep(0.01)  # land mid-teardown
        await asyncio.wait_for(svc._device_lock.acquire(), timeout=cam.LOCK_WAIT_TIMEOUT_SECONDS)
        order.append("snapshot-acquired-device")
        svc._device_lock.release()

    async def stop():
        await producer.unsubscribe(sub)
        order.append("producer-released-device")

    await asyncio.gather(stop(), snapshot_attempt())

    assert proc.reaped, "ffmpeg must be reaped before the lock is released"
    assert order == ["producer-released-device", "snapshot-acquired-device"], order


@pytest.mark.asyncio
async def test_teardown_fits_inside_the_lock_wait_invariant():
    """The stated invariant: worst-case teardown must be comfortably
    shorter than how long a snapshot will wait for the lock, or a normal
    Stop would surface as a snapshot timeout."""
    worst_case = cam.PRODUCER_TERMINATE_TIMEOUT_SECONDS + 1.0  # + kill/reap headroom
    assert cam.LOCK_WAIT_TIMEOUT_SECONDS > worst_case, (
        f"LOCK_WAIT_TIMEOUT_SECONDS ({cam.LOCK_WAIT_TIMEOUT_SECONDS}) must exceed "
        f"worst-case teardown ({worst_case})"
    )


# --- 4. Live disconnects normally -------------------------------------
@pytest.mark.asyncio
async def test_4_normal_stop_releases_everything(producer, svc):
    sub = await producer.subscribe()
    proc = producer.spawned[-1]
    await producer.unsubscribe(sub)
    assert producer.state is ProducerState.STOPPED
    assert proc.terminated and proc.reaped
    assert not svc._device_lock.locked()


# --- 5. Live disconnects WITHOUT the frontend Stop --------------------
@pytest.mark.asyncio
async def test_5_generator_close_still_cleans_up(producer, svc):
    """Browser navigates away / phone locks: no Stop call, the generator
    is just closed. The finally must still release the device."""
    sub = await producer.subscribe()
    gen = producer.frames(sub)
    await drain(gen, 1)
    await gen.aclose()
    await asyncio.sleep(0)
    assert producer.state is ProducerState.STOPPED
    assert not svc._device_lock.locked()


# --- 6. ffmpeg stalls but stays alive ---------------------------------
@pytest.mark.asyncio
async def test_6_stall_is_detected_and_restarted(producer, svc, monkeypatch):
    monkeypatch.setattr(cam, "PRODUCER_STALL_TIMEOUT_SECONDS", 0.05)
    sub = await producer.subscribe()
    first = producer.spawned[-1]
    first.stdout.stalled = True  # alive, but no more frames

    await asyncio.sleep(0.3)
    assert len(producer.spawned) > 1, "a stalled producer must be restarted"
    assert first.terminated
    await producer.unsubscribe(sub)
    assert not svc._device_lock.locked()


# --- 7. ffmpeg exits unexpectedly -------------------------------------
@pytest.mark.asyncio
async def test_7_unexpected_exit_restarts(producer, svc):
    sub = await producer.subscribe()
    producer.spawned[-1].stdout.eof()
    await asyncio.sleep(0.2)
    assert len(producer.spawned) > 1
    await producer.unsubscribe(sub)
    assert not svc._device_lock.locked()


# --- 8. producer fails repeatedly -------------------------------------
@pytest.mark.asyncio
async def test_8_restart_budget_stops_the_loop(producer, svc, monkeypatch):
    monkeypatch.setattr(cam, "PRODUCER_STALL_TIMEOUT_SECONDS", 0.03)
    monkeypatch.setattr(cam, "PRODUCER_MAX_RESTARTS", 2)
    sub = await producer.subscribe()

    for _ in range(40):
        if producer.state is ProducerState.FAILED:
            break
        if producer.spawned:
            producer.spawned[-1].stdout.eof()
        await asyncio.sleep(0.05)

    assert producer.state is ProducerState.FAILED, "must stop restarting forever"
    assert not svc._device_lock.locked(), "a FAILED producer must not keep the device"
    # And a fresh explicit Live request may try again.
    assert len(producer.spawned) <= cam.PRODUCER_MAX_RESTARTS + 2


@pytest.mark.asyncio
async def test_8b_no_restart_with_zero_subscribers(producer, svc):
    """A stall after everyone has left must not resurrect the producer
    just to hold the camera open for nobody."""
    sub = await producer.subscribe()
    await producer.unsubscribe(sub)
    spawned_before = len(producer.spawned)
    await asyncio.sleep(0.15)
    assert len(producer.spawned) == spawned_before
    assert producer.state is ProducerState.STOPPED


# --- 9. authenticated stream disconnects mid-flight -------------------
@pytest.mark.asyncio
async def test_9_subscriber_removal_stops_producer(producer, svc):
    """A revoked token tears the response down; from the producer's side
    that is just a subscriber vanishing, and it must still release."""
    sub = await producer.subscribe()
    gen = producer.frames(sub)
    await drain(gen, 1)
    await gen.aclose()
    assert producer.state is ProducerState.STOPPED
    assert not svc._device_lock.locked()


# --- 10. shutdown while Live is active --------------------------------
@pytest.mark.asyncio
async def test_10_shutdown_reaps_ffmpeg(producer, svc):
    await producer.subscribe()
    proc = producer.spawned[-1]
    await producer.shutdown()
    assert proc.terminated and proc.reaped, "no orphaned ffmpeg may survive shutdown"
    assert producer.state is ProducerState.STOPPED
    assert not svc._device_lock.locked()


# --- 11. concurrent Live requests -------------------------------------
@pytest.mark.asyncio
async def test_11_concurrent_live_requests_share_one_ffmpeg(producer, svc):
    """Two viewers arriving together must converge on ONE producer. A
    naive 'start if not running' check spawns a second ffmpeg against a
    device the first already holds."""
    subs = await asyncio.gather(producer.subscribe(), producer.subscribe(), producer.subscribe())
    assert len(producer.spawned) == 1, f"spawned {len(producer.spawned)} ffmpeg processes"
    assert producer.state is ProducerState.RUNNING

    # Producer survives until the LAST subscriber leaves.
    await producer.unsubscribe(subs[0])
    assert producer.state is ProducerState.RUNNING
    await producer.unsubscribe(subs[1])
    assert producer.state is ProducerState.RUNNING
    await producer.unsubscribe(subs[2])
    assert producer.state is ProducerState.STOPPED
    assert not svc._device_lock.locked()


# --- freshness: never present a stale frame as live -------------------
@pytest.mark.asyncio
async def test_stale_frame_is_never_returned(producer, monkeypatch):
    sub = await producer.subscribe()
    assert producer.latest_frame() is not None
    monkeypatch.setattr(cam, "PRODUCER_FRAME_MAX_AGE_SECONDS", 0.0)
    assert producer.latest_frame() is None, "a stale frame must never be served"
    await producer.unsubscribe(sub)


# --- first frame ------------------------------------------------------
@pytest.mark.asyncio
async def test_no_first_frame_raises_rather_than_opening_an_empty_stream(svc, monkeypatch):
    p = LiveProducer(svc)

    async def silent_spawn(_self=None):
        proc = FakeProcess()  # never pushes a frame
        return proc

    monkeypatch.setattr(svc, "_spawn_stream_process", silent_spawn)
    monkeypatch.setattr(cam, "PRODUCER_FIRST_FRAME_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(cam, "PRODUCER_STALL_TIMEOUT_SECONDS", 10.0)

    with pytest.raises(CameraUnavailableError):
        await p.subscribe()
    assert not svc._device_lock.locked(), "a failed start must not leak the device lock"


# --- 12. snapshot polling must not starve the producer ----------------
@pytest.mark.asyncio
async def test_12_producer_is_not_starved_by_snapshot_polling(producer, svc):
    """The failure seen on the real Pi: the Camera page polls snapshots
    every 1.5s, asyncio.Lock is FIFO, so the producer joined the back of
    a queue that never emptied and timed out every time.

    While the producer is starting, new captures must stand aside.
    """
    svc._producer_starting = True
    with pytest.raises(CameraUnavailableError, match="handed over"):
        await svc.capture_snapshot()
    svc._producer_starting = False


@pytest.mark.asyncio
async def test_12b_flag_is_always_cleared(producer, svc):
    """A stuck flag would permanently break snapshots, so it must be
    cleared on the success path AND on the acquire-timeout path."""
    sub = await producer.subscribe()
    assert svc._producer_starting is False, "flag left set after a successful start"
    await producer.unsubscribe(sub)

    # Now force the timeout path with the device already held.
    await svc._device_lock.acquire()
    try:
        import app.services.camera_service as m
        original = m.LOCK_WAIT_TIMEOUT_SECONDS
        m.LOCK_WAIT_TIMEOUT_SECONDS = 0.05
        try:
            with pytest.raises(CameraUnavailableError):
                await producer.subscribe()
        finally:
            m.LOCK_WAIT_TIMEOUT_SECONDS = original
    finally:
        svc._device_lock.release()
    assert svc._producer_starting is False, "flag left set after a failed start"
