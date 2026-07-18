# Remote HTTPS access via Cloudflare Tunnel

Gives Bongo Control a real, trusted HTTPS URL on your own domain —
reachable from anywhere, no port forwarding, works fine behind CGNAT
(the tunnel is an outbound-only connection from the Pi to Cloudflare).
This is also what makes the Android "Install app" button work at all —
Chrome requires a secure (HTTPS) context before it considers a site
installable, and that's not possible over plain `http://<pi-ip>:8090`.

**Prerequisite**: your domain's DNS is already on Cloudflare (confirmed
already true for this setup).

## 1. Create the tunnel (Cloudflare dashboard)

1. Go to the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels**.
2. **Create a tunnel** → choose **Cloudflared** as the connector type.
3. Name it something like `bongo-control`.
4. On the next screen ("Install and run a connector"), you'll see a command containing a long token — copy just the token value (everything after `--token`).

## 2. Add the public hostname routes

Still in the tunnel's configuration, add **two** Public Hostnames (you'll need both — one for the dashboard itself, one for the API/WebSocket it talks to):

| Subdomain | Path | Service |
|---|---|---|
| `bongo` (i.e. `bongo.yourdomain.com`) | (leave blank) | `HTTP` → `localhost:8090` |
| `bongo-api` (i.e. `bongo-api.yourdomain.com`) | (leave blank) | `HTTP` → `localhost:8000` |

(Replace `bongo`/`bongo-api` with whatever subdomain names you actually want — just keep them consistent with what you put in `.env` in step 3.)

WebSocket connections (`/ws/telemetry`) are proxied automatically through the `bongo-api` route — Cloudflare Tunnel handles the protocol upgrade transparently for HTTP-type origins, no separate configuration needed.

## 3. Configure the Pi

On the Pi, in the `bongo-control` folder, create a `.env` file (this is gitignored — your domain/token never get committed):

```bash
cat > .env << 'EOF'
VITE_API_URL=https://bongo-api.yourdomain.com
VITE_WS_URL=wss://bongo-api.yourdomain.com/ws/telemetry
CLOUDFLARE_TUNNEL_TOKEN=paste-your-token-here
EOF
```

(Replace the domain and token with your real values.)

## 4. Build and run — note the `--profile` flag

The `cloudflared` service only starts when you explicitly ask for it, so it doesn't try to run (and fail) for anyone not using this feature:

```bash
docker compose --profile cloudflare-tunnel up -d --build
```

The `--build` is important this time even if nothing else changed — the frontend needs to be *rebuilt* to bake in the new `VITE_API_URL`/`VITE_WS_URL` values (Vite only reads these at build time, not when the container starts).

## 5. Verify

```bash
docker compose ps
```
You should see `backend`, `frontend`, **and** `cloudflared` all running.

Then, from your phone (on mobile data, not the van's WiFi — to genuinely prove it's not just working because you're local):

```
https://bongo.yourdomain.com
```

Should load the dashboard with a padlock (valid HTTPS). Check Settings → General → Install App — the button should now actually appear on Chrome.

## Going forward

- **Local LAN access** (`http://<pi-ip>:8090`) still works exactly as before — this doesn't replace it, just adds an alternative.
- If you ever need to rebuild without touching the tunnel (e.g. just testing something locally), plain `docker compose up -d --build` (no `--profile` flag) works fine — `cloudflared` just won't be included in that particular `up`, but stays running if it was already started separately with the profile flag before.
