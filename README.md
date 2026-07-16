# Bongo Control

Open-source campervan dashboard OS. First supported vehicle: Mazda Bongo.
Part of the VanOS platform (plugin-based, hardware-agnostic, designed to
support other vehicles later).

## Sprint 1 scope

This is the Milestone 0/1 scaffold: a working, installable PWA with a
FastAPI backend streaming **realistic simulated telemetry** over a single
WebSocket. No hardware integrations yet (Victron, battery shunt, GPS,
MQTT) — those come later as plugins, without the frontend changing at all.

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

## API surface (Sprint 1)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | App + plugin status |
| `GET /api/{energy,battery,solar,environment,connectivity,vehicle,system}` | Current snapshot per domain |
| `GET /api/history/{domain}` | In-memory recent history (SQLite-backed history lands in a later milestone) |
| `GET /api/settings` | App config + plugin health |
| `WS /ws/telemetry` | Live stream — snapshot on connect, then every new reading |

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
| 1 | Tesla-style dashboard using simulated data (this scaffold — UI pending design sprint) |
| 2 | PWA installable on Android/iOS/Desktop |
| 3 | Victron Bluetooth integration |
| 4 | Battery shunt integration |
| 5 | History graphs and SQLite logging |
| 6 | External battery support |
| 7 | Vehicle automation and plugins |

## Design

Visual design (palette, typography, component design, mockups) is being
produced in a parallel design track — see `docs/design-system.md` (once
delivered) and `mockups/`. The current UI is intentionally unstyled
placeholder markup so it can be reskinned without touching data plumbing.
