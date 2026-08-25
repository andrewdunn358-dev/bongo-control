# uStreamer — giving the webcam a single owner

## Why

Measured on this Pi: **a single snapshot takes ~4.1 seconds.** Identical
with ffmpeg and with fswebcam, and only ~0.5s of that is CPU. The rest is
opening the USB device, negotiating the format, and waiting for
auto-exposure to settle.

Two problems follow from that, and neither is fixable while the device is
reopened for every frame:

- **Polling can't be faster than the device can answer.** At a 1.5s poll
  interval against a 4.1s capture, roughly three requests queued per
  cycle, the queue never drained, and callers timed out on the device
  lock. Every "camera busy" 503 traces back to this.
- **Every frame is the camera's *first* frame**, taken before
  auto-exposure has settled — which is why snapshots come out dark while a
  bare capture left running for a moment looks correct (YAVG 133 on this
  camera, properly exposed).

uStreamer holds `/dev/video0` open permanently. Exposure settles once and
stays settled, and a snapshot becomes "hand me the current frame" —
milliseconds, not seconds.

## Install (one time, on the Pi)

```
sudo apt update
sudo apt install -y ustreamer
```

If it isn't packaged on your OS version, build it:

```
sudo apt install -y build-essential libevent-dev libjpeg-dev libbsd-dev
git clone --depth=1 https://github.com/pikvm/ustreamer.git
cd ustreamer && make -j2
sudo make install
```

## Run it as a service

```
sudo tee /etc/systemd/system/ustreamer.service >/dev/null <<'EOF'
[Unit]
Description=uStreamer for the VanOS webcam
After=network.target

[Service]
ExecStart=/usr/bin/ustreamer \
  --device=/dev/v4l/by-id/usb-Suyin_HD_Camera_200910120001-video-index0 \
  --format=MJPEG \
  --resolution=640x480 \
  --desired-fps=5 \
  --host=127.0.0.1 \
  --port=8080 \
  --drop-same-frames=30
Restart=always
RestartSec=5
User=andrew

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ustreamer
systemctl status ustreamer --no-pager
```

Notes on those flags:

- `--device` uses the **by-id** path, not `/dev/video0`. The numbered
  device can move if USB enumerates differently after a reboot; the by-id
  path can't.
- `--host=127.0.0.1` binds to loopback only, so it is not exposed on the
  network. VanOS reaches it because the backend container runs with host
  networking.
- `--desired-fps=5` matches the existing stream cap. Frames are ~18KB on
  this camera, so 30fps would be ~1.9GB/hour over 4G and a constant CPU
  load on a Pi 2B that also runs a 0.2s roof-motor watchdog on the same
  event loop.
- `--drop-same-frames=30` stops it re-sending an identical frame of a
  parked, unchanging scene.

Check it works:

```
curl -s -o /tmp/u.jpg -w '%{http_code} %{size_download} bytes\n' http://127.0.0.1:8080/snapshot
```

## Point VanOS at it

In `.env` on the Pi:

```
CAMERA_USTREAMER_URL=http://127.0.0.1:8080
```

Then the usual deploy. Confirm which path is live:

```
curl -s localhost:8000/api/camera/status
```

`reachable: true` means snapshots are coming from uStreamer.

## The fallback

If `CAMERA_USTREAMER_URL` is unset, or uStreamer is stopped, or it
answers with something that isn't a JPEG, VanOS falls back to the
existing per-request ffmpeg capture and logs a warning. The camera gets
slow and badly exposed again, but it does not go dark.

That fallback is deliberate and worth keeping. The ffmpeg path is what
has worked all along; uStreamer is the better answer but is unproven on
this hardware, and this camera has a documented USB stability history
that a permanently-held device could plausibly aggravate.

If it does misbehave, `sudo systemctl stop ustreamer` returns everything
to the previous behaviour with no deploy and no code change.

## If it doesn't work

- `journalctl -u ustreamer -n 50` — usually says plainly what it wants.
- **Device busy** on start means something else holds the camera. Check
  for a stray ffmpeg: `ps aux | grep ffmpeg`.
- **Dark frames still** — give it a few seconds after start. Exposure
  settles once, but it does need those first frames.
