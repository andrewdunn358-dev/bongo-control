# Camera (USB Webcam) Live View

Live video from a USB webcam plugged directly into the Pi — streamed
**natively by the backend itself** (ffmpeg + MJPEG-over-HTTP), no
separate relay service at all.

## Why this approach, not go2rtc/WebRTC

An earlier version of this used go2rtc for a networked Tapo camera,
then kept using it once the setup switched to a USB webcam attached
directly to the Pi. That was solving the wrong problem: go2rtc/WebRTC/
MSE exist specifically to get video *across a network* and through
browser codec negotiation. A webcam plugged into the same machine the
backend already runs on has no network hop to solve for — so all of
that (a second container, a reverse-proxy path, WebRTC-with-MSE-
fallback, base_path config) was solved complexity for a problem that
didn't apply here.

MJPEG-over-HTTP is just an ordinary streaming HTTP response — a live
sequence of JPEG images. It rides on exactly the same `/api/` proxy
every other endpoint in this app already uses. No mixed-content
concerns, no separate reverse-proxy path, works identically over plain
HTTP and through the Cloudflare Tunnel's HTTPS with zero special-casing.

## 1. Confirm the device path and supported format

```bash
ls /dev/video*
v4l2-ctl --list-devices
v4l2-ctl --list-formats -d /dev/video0
```

If `v4l2-ctl --list-formats` shows `MJPG` in the list (most webcams
do), no changes needed — that's what's requested by default. If it
only lists `YUYV`, edit `input_format` in
`backend/app/services/camera_service.py`'s `CameraService.__init__`
default.

## 2. Configure the Pi (only if the device isn't `/dev/video0`)

```bash
echo "WEBCAM_DEVICE=/dev/videoX" >> .env
```

## 3. Run it

No profile flag needed — the camera endpoint is just part of the
backend now:

```bash
docker compose up -d --build
```

## 4. Verify

```bash
curl -sI http://localhost:8000/api/camera/stream
```
A `200` with `Content-Type: multipart/x-mixed-replace...` means it's
working. A `503` means ffmpeg couldn't open the device — check:

```bash
docker compose logs backend --tail=30
```

Then open the dashboard → **Camera**. Same address works identically
on the van's WiFi and through the Cloudflare Tunnel.

## Known limitation

V4L2 devices generally only support one consumer at a time. This
spawns a fresh `ffmpeg` process per request rather than a shared
broadcaster — fine for one viewer at a time (the realistic case here),
but a second person opening the Camera page simultaneously will get a
503 rather than sharing the existing stream. Worth revisiting if that
becomes a real problem.

## Troubleshooting

- **Blank image, 503 on the endpoint**: `docker compose logs backend`
  for the actual ffmpeg error - usually a wrong device path (recheck
  step 1) or the device being held open by something else.
- **High CPU / choppy video on the Pi**: try a lower resolution — the
  default is 640x480; edit `size` in `CameraService.__init__`.
