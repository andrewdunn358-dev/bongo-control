"""
Trips trail tests. Run: python backend/test_trip_trail.py

Same shape as test_history_compaction.py - a standalone script, no pytest
dependency on the Pi, against a real temp SQLite file. Synthetic GPS
trajectories, so nothing depends on the receiver.
"""

import math
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db.name}"
os.environ["VANOS_DATABASE_URL"] = f"sqlite:///{_tmp_db.name}"

from app.db.database import Base, SessionLocal, engine  # noqa: E402
from app.db.models import LocationHistory  # noqa: E402

from app.services.location_service import LocationService, TrailWalker, _haversine_metres  # noqa: E402

Base.metadata.create_all(bind=engine)

FAILS = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global FAILS
    print(f"{'PASS' if cond else 'FAIL'}  {name}{('  - ' + detail) if detail and not cond else ''}")
    if not cond:
        FAILS += 1


class FakeConfig:
    def __init__(self):
        self.d = {}

    def get(self, k, default=None):
        return self.d.get(k, default)

    def set(self, k, v):
        self.d[k] = v


def metres_north(lat, m):
    return lat + m / 111_320.0


def metres_east(lat, lon, m):
    return lon + m / (111_320.0 * math.cos(math.radians(lat)))


def drive(start_ts, lat, lon, n, step_m=60, every_s=4, heading_deg=45.0, wiggle_deg=0.0):
    """A continuous drive: n points, step_m apart, every_s seconds. With
    wiggle_deg the heading swings either side of its course like a
    winding road, without ever looping back on itself."""
    pts = []
    for i in range(n):
        pts.append((start_ts + i * every_s, lat, lon))
        h = heading_deg + wiggle_deg * math.sin(i / 8)
        lat = metres_north(lat, step_m * math.cos(math.radians(h)))
        lon = metres_east(lat, lon, step_m * math.sin(math.radians(h)))
    return pts


def walk(rows):
    w = TrailWalker()
    w.feed(rows)
    return w


def path_len(rows):
    return sum(_haversine_metres(a[1], a[2], b[1], b[2]) for a, b in zip(rows, rows[1:]))


T0 = 1_760_000_000.0
LAT, LON = 55.15, -1.60

# --- filter rules ---------------------------------------------------
d = drive(T0, LAT, LON, 200)
w = walk(d)
check("straight drive counted in full", abs(w.distance - path_len(d)) < 1, f"{w.distance} vs {path_len(d)}")
check("straight drive draws one run", len(w.runs) == 1)

curvy = drive(T0, LAT, LON, 400, step_m=60, every_s=4, wiggle_deg=70.0)
w = walk(curvy)
check("winding drive not mistaken for returning (120s lookback)", w.rejected == 0, f"rejected {w.rejected}")


jitter = [(T0 + i * 600 * 0.5, metres_north(LAT, (i % 3) * 5), LON) for i in range(50)]
w = walk(jitter)
check("parked jitter under 20m counts nothing", w.distance == 0 and w.rejected == 0)

tele = d[:50] + [(d[50][0], d[50][1] + 0.05, d[50][2])] + d[51:100]
w = walk(tele)
check("teleport fix rejected both ways", w.rejected >= 2)
check("teleport breaks the drawn line", len(w.runs) == 2, f"{len(w.runs)} runs")
check("teleport adds no distance", w.distance < path_len(d[:100]), "")

keep = [(T0, LAT, LON), (T0 + 600, metres_north(LAT, 300), LON)]
w = walk(keep)
check("keepalive-interval drift rejected", w.rejected == 1 and w.distance == 0)

# starburst: out ~200m and back every 5 minutes
star = []
for k in range(20):
    t = T0 + k * 300
    star += [(t, LAT, LON), (t + 150, metres_north(LAT, 200), LON)]
w = walk(star)
check("returned-nearby catches parked starburst", w.distance < 1000, f"{w.distance:.0f}m")

# --- source contamination -------------------------------------------
# van parked at LAT,LON; a phone 20km away keeps posting. Old behaviour
# stored both as "gps" and counted every hop.
far = metres_north(LAT, 20_000)
mixed = []
for k in range(10):
    t = T0 + k * 400
    mixed += [(t, LAT, LON), (t + 200, far, LON)]
w = walk(mixed)
check("old mixed data: 20km hops at <60m/s are NOT caught by speed alone (why the source split matters)",
      w.distance > 100_000 or w.rejected > 0, "")

# --- service: source split ------------------------------------------
svc = LocationService(FakeConfig())


def rows_in_db():
    db = SessionLocal()
    try:
        return db.query(LocationHistory).count()
    finally:
        db.close()


before = rows_in_db()
svc.set_from_gps(LAT, LON)
check("van GPS fix writes the trail", rows_in_db() == before + 1)
r = svc.set_from_device(far, LON)
check("phone ignored while van fix is fresh", r["applied"] is False and svc.get()["source"] == "gps")
check("phone never writes the trail", rows_in_db() == before + 1)
svc._last_van_fix_at -= 10_000
r = svc.set_from_device(far, LON)
check("phone sets current location when van fix is stale", r["applied"] is True and svc.get()["source"] == "device")
check("still no trail row from phone", rows_in_db() == before + 1)
r = svc.set_from_device(LAT, LON, manual=True)
check("manual entry applies, labelled manual, no trail row", svc.get()["source"] == "manual" and rows_in_db() == before + 1)

# --- service: stats + trail agree, cache invalidation ----------------
db = SessionLocal()
db.query(LocationHistory).delete()
db.add_all([LocationHistory(timestamp=t, latitude=a, longitude=b, source="gps") for t, a, b in d])
db.commit()
db.close()
svc = LocationService(FakeConfig())
s1 = svc.trip_stats(0.0)
tr = svc.trail(0.0, max_points=50)
check("trail and stats from the same walk", abs(tr["distance_metres"] - s1["distance_metres"]) < 1e-6)
check("decimated trail keeps endpoints", tr["runs"][0][0][0] == d[0][0] and tr["runs"][-1][-1][0] == d[-1][0])
check("decimation does not change distance", abs(svc.trip_stats(0.0)["distance_metres"] - path_len(d)) < 1)

more = drive(d[-1][0] + 4, d[-1][1], d[-1][2], 50)[1:]
db = SessionLocal()
db.add_all([LocationHistory(timestamp=t, latitude=a, longitude=b, source="gps") for t, a, b in more])
db.commit()
db.close()
s2 = svc.trip_stats(0.0)
check("incremental append picked up", abs(s2["distance_metres"] - path_len(d + more)) < 1)

db = SessionLocal()
db.query(LocationHistory).filter(LocationHistory.timestamp > d[100][0]).delete()
db.commit()
db.close()
s3 = svc.trip_stats(0.0)
check("delete invalidates cached total", abs(s3["distance_metres"] - path_len(d[:101])) < 1, f"{s3['distance_metres']}")

db = SessionLocal()
db.add(LocationHistory(timestamp=d[10][0] + 1, latitude=d[10][1], longitude=d[10][2], source="gps"))
db.query(LocationHistory).filter(LocationHistory.timestamp == d[100][0]).delete()
db.commit()
db.close()
s4 = svc.trip_stats(0.0)
check("edit with unchanged row count rebuilds", s4["points"] == 101 and s4["last_timestamp"] == d[99][0], f"{s4['points']} {s4['last_timestamp']}")

mid = d[50][0]
s5 = svc.trip_stats(mid)
tr5 = svc.trail(mid)
check("trip marker scopes stats", s5["first_timestamp"] == mid)
check("trip marker scopes trail", tr5["runs"][0][0][0] >= mid)

for i in range(10):
    svc.trip_stats(T0 + i)
check("window cache is bounded", len(svc._walkers) <= LocationService._MAX_WINDOWS)

os.unlink(_tmp_db.name)
print(f"\n{'ALL PASSED' if FAILS == 0 else f'{FAILS} FAILED'}")
sys.exit(1 if FAILS else 0)
