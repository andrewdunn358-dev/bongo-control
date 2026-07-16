# Architecture — Sprint 1

## Telemetry Bus

The core architectural decision for VanOS: **all data flows through one
bus, in one schema, regardless of source.**

```
Simulation Plugin ─┐
Victron Plugin ─────┼──▶ TelemetryBus ──▶ FastAPI ──▶ WebSocket ──▶ React
Battery Plugin ─────┘
```

- `backend/app/telemetry/models.py` — the shared `TelemetryMessage` schema
  (`domain`, `source`, `timestamp`, `payload`).
- `backend/app/telemetry/bus.py` — in-process async pub/sub. Plugins call
  `bus.publish()`; consumers call `bus.subscribe()`. Also caches the
  latest message per domain for REST snapshot endpoints.
- `backend/app/plugins/base.py` — the `Plugin` ABC every data source
  implements (`start()`, `stop()`, `health()`), plus a `PluginRegistry`
  that starts/stops all registered plugins together and reports status.
- `backend/app/plugins/simulation/engine.py` — the first (and currently
  only) plugin. Models solar irradiance, battery SoC integration, load
  cycling, environment, and connectivity, publishing all six domains
  once per second. There's deliberately no Vehicle/OBD domain — this
  vehicle has no OBD port, so real engine/ignition/odometer diagnostics
  are out of scope rather than permanent fake data.

## Why an in-process bus instead of Redis/MQTT from day one?

Sprint 1 targets a single container / single Raspberry Pi. An in-process
`asyncio.Queue`-based bus has zero operational overhead and is fully
sufficient at this scale. The `TelemetryBus` class is the single place
that would need to change to move to a real broker (e.g. if the plugin
architecture later runs plugins as separate processes/containers) — see
the note in `bus.py`. MQTT is already planned as a *plugin* transport
(a plugin that subscribes to an MQTT broker and republishes onto the
bus), which is different from replacing the bus itself.

## Frontend contract

The frontend has exactly one source of live truth: `TelemetryContext`
(`frontend/src/context/TelemetryContext.tsx`), backed by one WebSocket
connection (`frontend/src/services/websocket.ts`). Pages read from this
context via `useTelemetry()` and never touch the socket, never call
`fetch` for live data, and never branch on `message.source`. This is
what makes "swap simulation for real hardware without touching the
frontend" actually true rather than aspirational.

REST endpoints (`frontend/src/services/api.ts`) exist only for
non-realtime needs: health checks, settings, and history queries.

## Adding a real hardware plugin

1. Subclass `Plugin` in a new module under `backend/app/plugins/<name>/`.
2. In `start()`, spawn whatever background task reads the hardware
   (Bluetooth GATT notifications for Victron, serial for a shunt, etc.)
   and calls `bus.publish(TelemetryMessage(domain=..., source=...,
   payload={...}))` — using the **same payload shape** as the simulation
   engine for that domain, so the frontend needs zero changes.
3. Register it in `backend/app/main.py`'s `lifespan`, guarded by
   `settings.simulation_mode` or a per-plugin enable flag.
4. `PluginRegistry` and `/api/health` pick it up automatically.

## Frontend component set (Sprint 3)

To avoid duplicated UI code across pages, every page is built from a
small set of reusable pieces in `frontend/src/components/Cards/` and
`frontend/src/components/Timeline/`:

- **`Card`** — the base container (accent border, padding, entrance
  motion, hover lift). `accent` is `solar | battery | alert |
  neutral` — `alert` is reserved for genuine error/warning states
  (engine fault, offline), not decoration, per the "colour only
  communicates state" visual direction.
- **`MetricCard`** — a `Card` preset for a single stat: icon + label +
  large mono value + optional subtext. Used for every "one number"
  readout (Battery/Solar/Environment/Connectivity pages, Home's
  Quick Status row).
- **`StatRow`** — a label/value list row (optionally with a status dot),
  for cards showing several related facts together (Active Loads,
  Settings' app info and plugin health).
- **`Timeline`** — a vertical rail-and-dot list of timestamped entries.
  Shared by Home's Recent Events and the History page, so both read
  identically instead of each having their own list markup.

Adding a new page should mean composing these, not writing new card
markup from scratch.
