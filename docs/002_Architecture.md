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
  cycling, environment, connectivity, and vehicle state, publishing all
  seven domains once per second.

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
