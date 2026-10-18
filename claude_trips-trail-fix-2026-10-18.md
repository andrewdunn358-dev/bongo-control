# Trips trail fix — 18 Oct 2026 (commit ab51d8f)

Confirmed working on the Pi: the map now follows real roads, the long
straight lines across Northumberland are gone.

## The fault

The trail behind the Trips screen had **three writers stored identically**
as `source="gps"`:

1. the USB GPS receiver (gps_serial plugin) — correct
2. the phone/tablet browser (`useAutoLocate`, every 3 min while the
   dashboard is open over the Cloudflare URL)
3. the manual lat/lon box in Settings

Originally the phone *was* the GPS, so this made sense. Once the receiver
was fitted, opening the dashboard on a phone away from the van wrote the
phone's position into the van's trail. A 20km van↔phone hop a few minutes
apart passes the 60 m/s speed ceiling, so both legs were counted as miles
and drawn as straight lines. (Trips.tsx comments had already recorded a
report of "many crossing lines between two fixed points" — this was it.)

Second fault: the backend `trip_stats()` docstring described four filter
rules but only implemented the speed ceiling. Trips.tsx had all four as a
fallback. And the map drew every raw point regardless of either.

## What changed

- **`set_from_gps()`** — receiver only, called in-process by the plugin.
  The ONLY path that writes `location_history`.
- **`set_from_device(lat, lon, manual)`** — phone or Settings. Sets the
  current location only, never the trail. Automatic updates are ignored
  while the receiver has a fix under 2 min old (`VAN_FIX_FRESH_SECONDS`).
  Manual entries always apply (labelled `manual`).
- **`POST /api/location/device`** — new. **`POST /api/location/gps`** kept
  as an alias of `/device` for PWAs still running an old cached frontend —
  it no longer writes the trail.
- **`TrailWalker`** in `location_service.py` — the single implementation of
  the four rules (20m noise floor, 60 m/s ceiling, keepalive drift, returned
  nearby within 2–15 min / 150m). Streaming and incremental; the
  returned-nearby check uses a small grid so it stays fast on the Pi 2B.
- **`GET /api/location/trail`** — the accepted segments as separate runs,
  split at every rejected hop, from the same walk as `/trip-stats`. The map
  draws exactly what the mileage counts. Decimation happens only after
  distance is measured.
- Cache: rebuilt unless row count AND sum of timestamps match what was fed
  (count alone misses delete+insert; SQLite reuses row ids so max id
  doesn't help). Bounded to 4 windows, locked.
- `by_day` buckets in Europe/London (falls back to container time if the
  image has no tzdata).
- Trips.tsx client-side filter removed; Google and MapLibre maps draw one
  line per run. Settings shows "from van GPS / this device / set manually".
- Tests: `python backend/test_trip_trail.py` — 25 checks, all pass.

## Not done yet

- **Old polluted rows are still in the table.** The new filters catch some,
  not all. Next job: a read-only cleanup preview (candidate rows, before/
  after mileage), then deletion of reviewed row IDs only, with a DB backup
  first. Never automatic.
- `place_service.detect_stays()` still reads raw history (stays are parked
  points, which the distance filter deliberately rejects). New data is
  clean; old phone points can still create odd stay candidates until the
  cleanup is done.
- "Days logged" is still first-fix-to-last-fix span, not days travelled.
