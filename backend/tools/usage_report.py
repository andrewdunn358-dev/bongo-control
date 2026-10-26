"""Battery usage per day and per night, from the SmartShunt history - for sizing
a battery bank. Read-only.

Run on the Pi:
    docker compose exec -T backend python - < backend/tools/usage_report.py
"""
import json, os, sqlite3, time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
L = ZoneInfo("Europe/London")
DB = os.environ.get("VANOS_DB", "/app/data/vanos.db")
since = time.time() - 30 * 86400
con = sqlite3.connect(DB)
pts = []
for ts, pj in con.execute("SELECT timestamp, payload_json FROM telemetry_readings WHERE domain='battery' AND source='victron_shunt' AND timestamp>=? ORDER BY timestamp", (since,)):
    d = json.loads(pj); p = d.get("payload", d)
    c, v = p.get("current_a"), p.get("voltage")
    if isinstance(c, (int, float)):
        pts.append((ts, c, v))
sol = {}
for ts, pj in con.execute("SELECT timestamp, payload_json FROM telemetry_readings WHERE domain='solar' AND timestamp>=?", (since,)):
    d = json.loads(pj); p = d.get("payload", d)
    y = p.get("yield_today_wh")
    if isinstance(y, (int, float)):
        k = datetime.fromtimestamp(ts, L).date()
        sol[k] = max(sol.get(k, 0), y)
day, night = {}, {}
for (t0, c0, v0), (t1, c1, v1) in zip(pts, pts[1:]):
    dt = t1 - t0
    if not (0 < dt <= 300):
        continue
    ah = (c0 + c1) / 2 * dt / 3600
    lt = datetime.fromtimestamp(t0, L)
    s = day.setdefault(lt.date(), {"in": 0.0, "out": 0.0, "cov": 0.0, "vmin": 99})
    s["cov"] += dt
    if ah > 0: s["in"] += ah
    else: s["out"] -= ah
    if v0: s["vmin"] = min(s["vmin"], v0)
    # night = 18:00 to 08:00, filed under the evening's date
    if lt.hour >= 18 or lt.hour < 8:
        nk = lt.date() if lt.hour >= 18 else lt.date() - timedelta(days=1)
        n = night.setdefault(nk, {"out": 0.0, "net": 0.0, "cov": 0.0})
        n["cov"] += dt; n["net"] += ah
        if ah < 0: n["out"] -= ah
print("DAILY (Ah through the shunt; solar from the MPPT only - PWM panel not seen)")
print(f"{'Day':<10} {'In Ah':>6} {'Out Ah':>7} {'Net Ah':>7} {'Solar Wh':>8} {'Min V':>6} {'Cover':>6}")
for k in sorted(day):
    s = day[k]
    print(f"{k:%a %d/%m}  {s['in']:6.1f} {s['out']:7.1f} {s['in']-s['out']:+7.1f} {sol.get(k, 0):8.0f} {s['vmin']:6.2f} {min(100, s['cov']/864):5.0f}%")
print("\nOVERNIGHT 18:00-08:00 (what the bank has to carry with no sun)")
print(f"{'Night of':<10} {'Used Ah':>8} {'Net Ah':>7} {'Cover':>6}")
good = []
for k in sorted(night):
    n = night[k]
    cov = n["cov"] / (14 * 36)
    print(f"{k:%a %d/%m}  {n['out']:8.1f} {n['net']:+7.1f} {min(100, cov):5.0f}%")
    if cov >= 80: good.append(n["out"])
if good:
    good.sort()
    print(f"\nFull nights: {len(good)}  typical {good[len(good)//2]:.0f}Ah  worst {good[-1]:.0f}Ah")
