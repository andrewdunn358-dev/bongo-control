# Camera (USB Webcam) Live View

Live video from a USB webcam plugged directly into the Pi, via
[go2rtc](https://github.com/AlexxIT/go2rtc)'s native V4L2 (USB camera)
support — no separate streaming tool needed, and it's the same
well-tested go2rtc already confirmed working for BLE-adjacent camera
work on this Pi, just pointed at a different source.

(This replaced an earlier Tapo C113 RTSP setup — the Tapo moved to
house use instead. The old config is kept commented in
`docker/go2rtc.yaml` in case a second camera gets added back later.)

## 1. Confirm the device path and supported format

```bash
ls /dev/video*
v4l2-ctl --list-devices
v4l2-ctl --list-formats -d /dev/video0
```

Most USB webcams show up as `/dev/video0` unless something else on the
Pi already claims that path. The format list matters — `docker/go2rtc.yaml`
requests `input_format=mjpeg` deliberately (far less USB bandwidth than
raw YUYV, which matters on a Pi 2), but not every webcam supports MJPEG
capture. If `v4l2-ctl --list-formats` doesn't show `MJPG` in the list,
edit `docker/go2rtc.yaml` and drop the `input_format=mjpeg` parameter.

## 2. Configure the Pi (only if the device isn't `/dev/video0`)

```bash
echo "WEBCAM_DEVICE=/dev/videoX" >> .env
```

## 3. Run it

```bash
docker compose --profile camera up -d --build
```

(Combine with other profiles as needed, e.g. `--profile camera --profile cloudflare-tunnel`.)

## 4. Verify

```bash
docker compose ps        # go2rtc should show Up
docker compose logs go2rtc --tail=30
```

Look for a line confirming the `cctv` stream picked up the device. A
"no such file or directory" or permission error here usually means the
device path is wrong (recheck step 1) or `devices:` in
`docker-compose.yml` isn't mapping to the actual path.

Then open the dashboard → **Camera**. Same address works whether you're
on the van's WiFi (real-time WebRTC) or connecting remotely through the
Cloudflare Tunnel (automatic MSE fallback, slightly delayed) — go2rtc
is proxied through nginx under the same origin as the rest of the app
either way, so there's nothing extra to configure for either case.

## Troubleshooting

- **Blank iframe**: check `docker compose logs go2rtc` first — wrong
  device path or unsupported format both show up there clearly.
- **Works on WiFi, blank remotely**: check the nginx `/camera/` proxy —
  `docker compose logs frontend` for errors, and confirm
  `base_path: /camera` in `docker/go2rtc.yaml` matches nginx's location
  block in `docker/nginx.conf`.
- **High CPU / choppy video on the Pi**: try a lower resolution — add
  `&video_size=640x480` to the stream URL in `docker/go2rtc.yaml`.
