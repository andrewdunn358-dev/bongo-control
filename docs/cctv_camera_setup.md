# CCTV Camera (Tapo C113) Live View

Live video from a Tapo C113 via [go2rtc](https://github.com/AlexxIT/go2rtc) —
confirmed the C113 supports RTSP + ONVIF directly (it's wired, not one
of the battery-only Tapo models that lack this).

**Important limitation, read this first**: this only works while
you're on the van's own WiFi, same network as the Pi and the camera.
WebRTC is peer-to-peer — it needs a direct connection between your
phone and the Pi, which a Cloudflare Tunnel can't carry (tunnels handle
HTTP/WebSocket traffic; WebRTC uses direct UDP). There's no remote
viewing here, by design, not as a bug.

## 1. Create a local Camera Account (Tapo app)

This is a **separate credential** from your Tapo cloud login:

1. Open the Tapo app → tap the camera → gear icon (Settings)
2. **Advanced Settings → Camera Account**
3. Create a username and password here

## 2. Find the camera's local IP

Same Camera Settings screen → **Device Info**, or check your router's
DHCP client list. Worth setting a DHCP reservation for it so the IP
doesn't change later and silently break the stream.

## 3. Configure the Pi

Add to your `.env` file (same one used for the Cloudflare Tunnel setup):

```bash
TAPO_CAMERA_USER=your-camera-account-username
TAPO_CAMERA_PASS=your-camera-account-password
TAPO_CAMERA_IP=192.168.x.x
```

## 4. Run it

The `go2rtc` service only starts with the `camera` profile:

```bash
docker compose --profile camera up -d --build
```

(Combine profiles if you're also using Cloudflare Tunnel: `docker
compose --profile camera --profile cloudflare-tunnel up -d --build`)

## 5. Verify

```bash
docker compose ps
```
Should show `go2rtc` as `Up`.

```bash
docker compose logs go2rtc --tail=30
```
Look for a line confirming the `cctv` stream connected — if it instead
shows a connection/auth error, double check the Camera Account
credentials and IP.

Then, **on the van's WiFi**, open the dashboard at its local address
(`http://<pi-ip>:8090`, not the `https://` tunnel address — see the
limitation above) and go to **Camera**.

## Why go2rtc's own player (an iframe), not a custom video component

go2rtc ships a tested reference player (`stream.html`) that
automatically tries WebRTC first and falls back to MSE (a
WebSocket-based streaming mode) if a direct peer-to-peer connection
can't establish. Reimplementing that fallback logic from scratch with
raw `RTCPeerConnection` calls would be redoing work go2rtc has already
solved and tested — the iframe embed uses their code directly instead.

## Why `/stream2`, not `/stream1`

`docker/go2rtc.yaml` requests the Tapo's lower-resolution substream.
go2rtc only *remuxes* video (repackages the existing compressed stream,
never re-encodes it), so CPU cost is low either way on a Pi 2 — but the
substream is still lighter on the Pi's network stack and whatever's
viewing it, with no real downside for a "check the van" camera.

## Troubleshooting

- **Blank iframe, dashboard loaded fine**: check `docker compose logs
  go2rtc`. A wrong password/IP shows up there clearly.
- **Works on WiFi, not remotely**: expected — see the limitation at
  the top.
- **Loaded via `https://bongo.yourdomain.com` and camera page shows a
  warning about HTTPS**: expected — the browser blocks loading
  `http://` content (go2rtc has no TLS configured) inside an `https://`
  page. Switch to the local `http://<pi-ip>:8090` address.
