# Bongo Control

Open-source campervan dashboard OS. First supported vehicle: Mazda Bongo.
Part of the VanOS platform (plugin-based, hardware-agnostic, designed to
support other vehicles later).

## What this actually does today

Started as a simulated-data scaffold; confirmed running against real
hardware in an actual van since. Current capabilities:

- **Live telemetry** over a single WebSocket - battery voltage/charge
  state and solar production from a real Victron SmartSolar MPPT over
  Bluetooth, or realistic simulated data when no hardware is connected
- **Weather forecasting** (Open-Meteo, no API key needed) with a solar
  production outlook comparing tomorrow's forecast against today's
  actual recorded yield
- **Nearby places** (campsites, dump points, water, fuel) from
  OpenStreetMap, cached locally so it still works with no signal -
  arguably most useful exactly when you have none
- **AI-powered local recommendations** ("what's cool nearby right
  now") via Claude - optional, costs a small amount per call, see
  [`docs/ai_features.md`](docs/ai_features.md)
- **Live camera view** from a USB webcam attached to the Pi, streamed
  natively (no separate relay service) - see
  [`docs/cctv_camera_setup.md`](docs/cctv_camera_setup.md)
- **WiFi switching** from the dashboard itself (useful when a 4G/5G
  MiFi loses signal but a phone hotspot or site WiFi is available)
- **Remote HTTPS access** via Cloudflare Tunnel - no port forwarding,
  works behind CGNAT - see
  [`docs/remote_access_cloudflare_tunnel.md`](docs/remote_access_cloudflare_tunnel.md)
- **Optional password gate** for sensitive features (camera; future
  relay control) - a single shared password, not per-user accounts,
  matching a one-household van rather than a multi-tenant product
- **Light/Dark/System theme**, installable as a PWA on Android/iOS/Desktop
- **Daily SITREP** - a Green/Amber/Red mission status derived from
  battery + weather, with plain-English recommendations and
  predictions (estimated runtime, heater-tonight, solar outlook)
- **History graphs** - SQLite-backed, sampled to avoid wearing out an
  SD card

**Deliberately not built**: Vehicle/OBD diagnostics (this Bongo has no
OBD port, so real engine/ignition data isn't achievable - rather than
fake it, that whole domain is out of scope). Relay control (switching
physical things in the van) is designed for but not yet built - the
password gate above exists ahead of that specifically.

## Architecture

```
Simulation Plugin ─┐
Victron Plugin ─────┼──▶ Telemetry Bus ──▶ FastAPI ──▶ WebSocket ──▶ React
Battery Plugin ─────┘
```

Every data source — simulation today, real hardware later — publishes
`TelemetryMessage`s (`domain` + `payload`) onto one in-process
**Telemetry Bus**. FastAPI streams whatever's published straight out over
`/ws/telemetry`. The frontend subscribes once and never knows or cares
whether a given reading came from simulation or a real device.

See `backend/app/telemetry/`, `backend/app/plugins/base.py`, and
`backend/app/plugins/simulation/engine.py` for the implementation.

## Repository structure

```
backend/     FastAPI app, Telemetry Bus, plugin framework, simulation engine
frontend/    React + Vite + TypeScript + Tailwind PWA
docker/      Dockerfiles + nginx config
docs/        Architecture / design notes
images/      Screenshots, diagrams
mockups/     Design sprint output (from the UI/UX design track)
```

## Quick start (Docker — recommended)

```bash
docker compose up --build
```

- Frontend: http://localhost:8090
- Backend API: http://localhost:8000 (docs at `/docs`)
- WebSocket: `ws://localhost:8000/ws/telemetry`

## Local development (without Docker)

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional, defaults work out of the box
PYTHONPATH=. uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # optional, defaults auto-detect the backend
npm run dev
```

Visit http://localhost:5173. Vite proxies nothing — the frontend talks
directly to the backend's REST + WebSocket endpoints (CORS is configured
on the backend for this).

## API surface (selected — not exhaustive, see `/docs` for the full OpenAPI spec)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | App + plugin status |
| `WS /ws/telemetry` | Live stream — snapshot on connect, then every new reading |
| `GET /api/history/{domain}` | SQLite-backed sampled history |
| `GET /api/settings`, `/api/plugins`, `/api/config/{section}` | App config + plugin health/management |
| `GET/POST /api/location`, `/api/location/gps`, `/api/location/ip-fallback` | Current location - GPS, manual, or IP-based fallback |
| `GET /api/poi/nearby` | Cached OpenStreetMap POIs (campsites, dump points, water, fuel) |
| `GET /api/ai/nearby-recommendations` | AI-suggested local recommendations (optional, needs `ANTHROPIC_API_KEY`) |
| `GET /api/intelligence/mission-brief` | Daily SITREP - Green/Amber/Red status, recommendations, predictions |
| `GET /api/camera/snapshot` | Live webcam frame (auto-refreshing snapshot, not continuous video) |
| `GET/POST /api/wifi/*` | Scan and connect to WiFi networks from the dashboard |
| `POST /api/auth/unlock` | App password gate (optional - see `APP_ACCESS_PASSWORD`) |

## Adding a real hardware plugin later

1. Implement the `Plugin` interface (`backend/app/plugins/base.py`):
   `start()`, `stop()`, publish `TelemetryMessage`s onto the shared bus.
2. Register it in `backend/app/main.py`'s lifespan (alongside, or instead
   of, `SimulationEngine`).
3. Nothing else changes — same domains, same message shape, same
   WebSocket stream, same frontend.

## Roadmap

| Milestone | Goal |
|---|---|
| 0 | Project skeleton, Docker, GitHub, README ✅ |
| 1 | Tesla-style dashboard using simulated data ✅ (polished across several design sprints) |
| 2 | PWA installable on Android/iOS/Desktop ✅ |
| 3 | Victron Bluetooth integration ✅ (confirmed against real hardware in the van) |
| — | Plugin Manager + Service Layer ✅ |
| 5 | History graphs and SQLite logging ✅ |
| — | Weather + solar outlook ✅ |
| — | Nearby POI (offline-capable) + AI recommendations ✅ |
| — | Remote HTTPS access (Cloudflare Tunnel) ✅ |
| — | USB webcam live view ✅ |
| — | WiFi switching from the dashboard ✅ |
| — | App-wide password gate ✅ (built ahead of relay control, specifically for it) |
| — | Daily SITREP / Intelligence Engine ✅ |
| 4 | Battery shunt integration ⏸ paused — needs a SmartShunt, not yet owned |
| 6 | External battery support ⏸ paused — same hardware dependency as Milestone 4 |
| 7 | Relay control (switch physical things in the van) 🔜 designed for, not yet built |

**Note:** there's deliberately no Vehicle/OBD domain or page. This
vehicle has no OBD port, and adding one would be impractical — so real
engine/ignition/odometer diagnostics are permanently out of scope
rather than left as fake simulated data with no path to becoming real.

## Design

Visual design (palette, typography, component design, mockups) is being
produced in a parallel design track — see `docs/design-system.md` (once
delivered) and `mockups/`. The current UI is intentionally unstyled
placeholder markup so it can be reskinned without touching data plumbing.
