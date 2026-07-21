# Bongo Control — PRD

## Problem statement (verbatim, condensed)
Web-based PWA that reskins Bongo Control to a Tesla-cockpit aurora / deep-navy
aesthetic. Target users are van-lifers running the app on a tablet mounted in
the van and on a phone as a PWA. Seven screens:
Dashboard · SITREP · Nearby Places · Weather · Camera · History · WiFi & Settings.

## User personas
- **Tablet-in-van driver**: needs quick landscape cockpit with big legible telemetry.
- **Phone user on the go**: needs compact portrait stack with bottom tab bar.

## Core requirements (static)
1. Aurora / deep-navy palette, glassmorphism, aurora glow accents.
2. Space Grotesk (UI) + JetBrains Mono (numbers) typography.
3. Live WebSocket telemetry (battery SoC gauge, solar meter).
4. Green/Amber/Red SITREP mission badge + plain-English recs.
5. Dark MapLibre map with POI pins + AI picks panel + offline-cached badge.
6. Current weather + 7-day forecast + solar irradiance dual-bar chart (Open-Meteo).
7. Password-gated live camera with snapshot strip.
8. History graphs (battery / solar / load / temp) with 1H/24H/7D/30D toggles.
9. WiFi scan/connect UI + plugin health + tunnel status + theme toggle.
10. Responsive: tablet-first landscape, phone bottom-tab bar.

## Implementation status (2026-07-21)
- ✅ Design tokens, Space Grotesk / JetBrains Mono fonts, aurora background.
- ✅ Primitives: `GlassCard`, `AuroraBackground`, `StatusPill`, `GaugeRing`, `Sparkline`, `NavShell`.
- ✅ Dashboard with live SoC gauge, solar sparkline, load card, small stat tiles, quick circuits, runtime forecast.
- ✅ SITREP screen consuming `/api/intelligence/mission-brief`.
- ✅ Nearby Places with MapLibre (Carto dark-matter style), POI markers, filter chips, offline badge, AI picks card.
- ✅ Weather screen (Open-Meteo pass-through) with current, 7-day forecast, today-vs-tomorrow bar chart.
- ✅ Camera view with password gate (`bongo`), synthesized live SVG frame, snapshot strip.
- ✅ History graphs with 1H/24H/7D/30D range toggles + 4 domains.
- ✅ WiFi & Settings: network scan/connect, theme toggle, plugin health, tunnel status.
- ✅ FastAPI backend with `/api/ws/telemetry` WebSocket + all 12+ REST endpoints.
- ✅ Responsive tablet + phone layouts with bottom tab bar on phone.

## Backlog / next tasks
- **P1** Persist user's map center & preferred POI type filter to localStorage.
- **P1** Add light theme tokens now that toggle exists (only dark active today).
- **P2** PWA manifest + install icons + offline shell caching.
- **P2** Real Victron/BMS data source hooks behind the same SimState interface.
- **P2** Reverse-camera stream from actual RTSP proxy instead of synthesized SVG.
- **P2** Storybook of primitives for van-lifer plugin authors.
