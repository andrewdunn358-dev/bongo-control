# Bongo Control — PRD (rebuild)

## Ownership boundary
- **Real repo**: `github.com/andrewdunn358-dev/bongo-control` — has the working
  FastAPI backend that talks to actual hardware (Victron over Bluetooth, DS18B20
  1-Wire probes, GPIO relays, USB webcam via ffmpeg).
- **This workspace `/app/backend/server.py`**: **MOCK ONLY**. Mirrors the API
  contract (§2 of the rebuild spec) so the sandbox preview renders live. Do NOT
  merge this file to the real repo — the real backend already implements the
  contract talking to hardware.
- **Merge target**: only `/app/frontend/**` moves to the real repo.

## Honesty principle (load-bearing)
Every screen follows one rule: **never present absent or estimated data as
measured fact**. Concretely:
- `battery.soc_pct` is always `null` (no shunt) → we render `—%` and explicitly
  say why. There is NO SoC gauge on this project.
- Relay states are labelled **commanded on**, not `on` — relays sit in parallel
  with physical switches.
- `EnvironmentPayload.humidity_pct` is always `null` (DS18B20 is temp-only) → render `—`.
- `EnergyPayload.loads` is `{}` on real hw → render an explicit "no circuit sensing" message.
- POI cache dates surfaced when the response is cached.
- AI recommendations are labelled "AI-generated · please verify".
- **Simulated-data banner** appears whenever any WS message has `source === "simulation"`,
  naming every affected domain. Non-negotiable safety net.

## Stack
- **Frontend**: React 18.3 + Vite 5 + TypeScript 5.6 + Tailwind
- **Charts**: Recharts (colours resolved from theme in JS, not CSS)
- **Motion**: framer-motion
- **Map**: MapLibre GL with CartoDB dark-matter style (no token)
- **WS path**: `import.meta.env.DEV ? '/api/ws/telemetry' : '/ws/telemetry'`
  (build-time constant; no `VITE_*` env var — same-origin relative paths are load-bearing)

## Screens (10 total; mobile bottom nav shows 6: Home / Switches / Weather / Nearby / Camera / Settings)
1. **Home** — SITREP verdict, voltage, solar watts, temperature, net energy. **No SoC gauge.**
2. **Energy** — solar in / net / load out; loads dict rendered honestly (empty on real hw).
3. **Battery** — voltage-first, explicit "—% SoC" with reason.
4. **Solar** — MPPT charge state, watts, yield, LOAD-terminal caveat.
5. **Weather** — current + today/tomorrow tiles + irradiance ratio + 5-day. WS-driven.
6. **Nearby** — MapLibre dark map, POI list, offline-cache badge, gated AI card.
7. **Switches** — relays with `commanded on/off` labels + parallel-wiring caveat + all-off.
8. **Camera** — password gate → snapshot polling ~1.5s with preload-swap to avoid flicker.
9. **History** — 4 domains (battery / solar / environment / energy) × 4 ranges (1h/24h/7d/30d) using `hours` float param.
10. **Settings** — WiFi scan/connect, theme toggle (dark/light), plugin health.

## What lives where (frontend)
```
frontend/
  index.html                       # Vite root; SW registration; theme flash guard
  vite.config.ts                   # Dev proxy /api → :8001, ws: true
  tsconfig.json / tsconfig.node.json
  tailwind.config.ts               # `ink` theme-aware colour token
  public/
    manifest.json  icon.svg  apple-touch-icon.svg  service-worker.js
  src/
    main.tsx  App.tsx  index.css
    lib/
      config.ts     # TELEMETRY_WS_PATH (import.meta.env.DEV shim)
      api.ts        # fetch client, endpoints
      telemetry.ts  # Per-domain WS store + typed hooks (useBattery, useSolar…)
      theme.tsx     # ThemeProvider + useChartColors (theme-aware recharts)
      types.ts      # All backend contract types (§2)
      format.ts     # DASH-honest formatters
      utils.ts
    components/
      NavShell.tsx          # 10-link top nav / 6-tab bottom nav
      SimBanner.tsx         # Simulated-data banner (safety)
      UpdateBanner.tsx      # PWA update prompt
      RouteErrorBoundary.tsx
      primitives/AuroraBackground.tsx  GlassCard.tsx  StatusPill.tsx  Sparkline.tsx
    screens/
      Home.tsx  Energy.tsx  Battery.tsx  Solar.tsx  Weather.tsx
      Nearby.tsx  Switches.tsx  Camera.tsx  History.tsx  Settings.tsx
    constants/testIds.ts
```

## Verified in the sandbox (2026-02)
- WebSocket connects, all 7 domains stream, `source: "simulation"` triggers the sim banner.
- Battery voltage renders live, sparkline populates.
- All 10 routes render without crashing.
- `yarn typecheck` passes with `strict: true`.
- Theme toggle flips CSS variables; recharts axes recolour on toggle.

## Post-merge to real repo (checklist for the operator)
- Copy `frontend/` only.
- Do NOT copy `backend/server.py` — it's the mock.
- Run `yarn install` in `frontend/` (pulls maplibre-gl).
- Verify against the real backend that the WS connects at `/ws/telemetry` and per-domain messages arrive.
- Run Lighthouse for PWA installability on the deployed build.

## Backlog
- **P1** Weather MJ/m² outlook could use a small sparkline of hourly irradiance if the backend exposes it.
- **P2** Storybook of primitives so plugin authors can reuse them.
- ~~**P2** History downsampling on the client for 7d/30d ranges when the backend returns >1000 points.~~ **Done server-side** — see §2.3 contract addendum below.

## §2.3 contract addendum — history downsampling
`GET /api/history/{domain}` accepts an optional `max_points: int` query param.

  - Omitted → server returns every stored sample.
  - Present and `< len(series)` → the raw series is grouped into `max_points`
    fixed-duration **time buckets**. Numeric values within a bucket are
    **averaged**; nulls are **excluded from the mean** (so a chronically-null
    field never poisons the average of the subset that has real readings).
    If every value in a bucket is null, the bucket's value is `null`.
    Bucket timestamps are the **midpoint** of each bucket's range — the
    series is not shifted rightward.
  - Booleans / nested structures are taken from the **last reading in the
    bucket**, not averaged (averaging `charging: true/false` into `0.6` is
    meaningless). The mock only stores scalars per domain, so this clause is
    a no-op in-sandbox but is honoured by the real backend on the Pi.
  - Present and `>= len(series)` → **no-op**, returns every sample. So
    `max_points` is safe to always send.

Server-side because the Pi 2 is the weakest link — pushing 43,000 points
(30 days of 60-second solar samples) over a slow connection so a phone can
throw most away wastes CPU, bandwidth, and memory on both ends.

**Suggested frontend usage** (implemented in `screens/History.tsx`):
`max_points=500` for the 7D and 30D ranges, omitted for 1H and 24H.

## React Router v7 future flags (enabled)
`<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>`
in `App.tsx`. `v7_relativeSplatPath` changes how relative routes resolve
inside splat parents; the real repo's Settings has nested route children
per-plugin — please click through them after merging to confirm each plugin
config page still loads. In-sandbox Settings has no nested routes, so no
regression is visible here.
