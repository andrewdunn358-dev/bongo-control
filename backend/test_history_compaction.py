"""
History compaction tests. Run: python backend/test_history_compaction.py

Same shape as test_battery_alarms.py - a standalone script, no pytest
dependency on the Pi. Drives HistoryService against a real temp SQLite
file (not a fake), because the thing under test IS the SQL - bucketing,
grouping by source, and the delete+insert round trip.
"""

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

# Point at a throwaway DB file before any app module is imported, since
# app.db.database builds the engine at import time from the env var.
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db.name}"

from app.db.database import Base, SessionLocal, engine  # noqa: E402
from app.db.models import TelemetryReading  # noqa: E402
from app.services.history_service import (  # noqa: E402
    COMPACTABLE_DOMAINS,
    COMPACTION_AFTER_HOURS,
    COMPACTION_BUCKET_SECONDS,
    HistoryService,
)

Base.metadata.create_all(bind=engine)

failures = []


def check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        failures.append(label)


def reset_db():
    db = SessionLocal()
    db.query(TelemetryReading).delete()
    db.commit()
    db.close()


def insert(domain, source, timestamp, **payload):
    db = SessionLocal()
    db.add(
        TelemetryReading(
            domain=domain,
            source=source,
            timestamp=timestamp,
            payload_json=json.dumps(payload),
        )
    )
    db.commit()
    db.close()


def rows_for(domain):
    db = SessionLocal()
    rows = (
        db.query(TelemetryReading)
        .filter(TelemetryReading.domain == domain)
        .order_by(TelemetryReading.timestamp)
        .all()
    )
    result = [(r.source, r.timestamp, json.loads(r.payload_json)) for r in rows]
    db.close()
    return result


def fresh_service():
    # telemetry_service is only used by the sample loop (subscribe/
    # unsubscribe), never by _compact_old_readings or _prune - None is
    # fine for these tests, same as test_battery_alarms.py's pattern of
    # passing None where a collaborator isn't exercised.
    return HistoryService(telemetry_service=None)


async def main():
    now = time.time()
    old_enough = now - (COMPACTION_AFTER_HOURS * 3600) - 3600  # just past the boundary

    print("=== 1. A DENSE OLD BUCKET COLLAPSES TO ONE HOURLY ROW ===")
    reset_db()
    hour_start = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    for i in range(10):
        insert("battery", "smartshunt", hour_start + i * 60, soc_pct=50.0 + i, voltage=12.0)
    svc = fresh_service()
    svc._compact_old_readings()
    rows = rows_for("battery")
    check("ten readings collapse into exactly one row", len(rows) == 1)
    check(
        "the merged SoC is the average of the bucket, not just the last value",
        rows and abs(rows[0][2]["soc_pct"] - sum(50.0 + i for i in range(10)) / 10) < 1e-6,
    )

    print("\n=== 2. RECENT DATA IS UNTOUCHED ===")
    reset_db()
    for i in range(5):
        insert("battery", "smartshunt", now - i * 60, soc_pct=70.0)
    svc = fresh_service()
    svc._compact_old_readings()
    rows = rows_for("battery")
    check("readings inside the 48h window are left at full resolution", len(rows) == 5)

    print("\n=== 3. DIFFERENT SOURCES IN THE SAME HOUR ARE NEVER MIXED ===")
    reset_db()
    hour_start = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    for i in range(5):
        insert("battery", "smartshunt", hour_start + i * 60, soc_pct=50.0)
    for i in range(5):
        insert("battery", "mppt", hour_start + i * 60, soc_pct=90.0)
    svc = fresh_service()
    svc._compact_old_readings()
    rows = rows_for("battery")
    sources = {r[0] for r in rows}
    check("two publishers in the same hour produce two rows, not one blended row", len(rows) == 2)
    check("both source labels survive", sources == {"smartshunt", "mppt"})
    values = {r[0]: r[2]["soc_pct"] for r in rows}
    check("the shunt's figures are not blended with the MPPT's", values["smartshunt"] == 50.0 and values["mppt"] == 90.0)

    print("\n=== 4. A SINGLE READING IN A BUCKET IS LEFT ALONE ===")
    reset_db()
    hour_start = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    insert("battery", "smartshunt", hour_start + 30, soc_pct=61.0)
    svc = fresh_service()
    svc._compact_old_readings()
    rows = rows_for("battery")
    check("a bucket that's already at (or below) target resolution is untouched", len(rows) == 1 and rows[0][2]["soc_pct"] == 61.0)

    print("\n=== 5. RE-RUNNING ON ALREADY-COMPACTED DATA IS A SAFE NO-OP ===")
    reset_db()
    hour_start = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    for i in range(10):
        insert("battery", "smartshunt", hour_start + i * 60, soc_pct=50.0 + i)
    svc = fresh_service()
    svc._compact_old_readings()
    first_pass = rows_for("battery")
    svc._compact_old_readings()
    second_pass = rows_for("battery")
    check("row count is stable across repeated runs", len(first_pass) == len(second_pass) == 1)
    check("the value doesn't drift on a second pass", abs(first_pass[0][2]["soc_pct"] - second_pass[0][2]["soc_pct"]) < 1e-6)

    print("\n=== 6. NON-COMPACTABLE DOMAINS ARE UNTOUCHED (event-shaped heating) ===")
    reset_db()
    check("HEATING is deliberately excluded from compaction", "heating" not in COMPACTABLE_DOMAINS)
    hour_start = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    for i in range(10):
        insert("heating", "hcalory", hour_start + i * 60, state="running")
    svc = fresh_service()
    svc._compact_old_readings()
    rows = rows_for("heating")
    check("heating readings are left at full resolution even when old", len(rows) == 10)

    print("\n=== 7. NON-NUMERIC / NESTED FIELDS TAKE THE LAST READING, NOT AN AVERAGE ===")
    reset_db()
    hour_start = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    insert("connectivity", "modem", hour_start, online=True, signal_bars=2)
    insert("connectivity", "modem", hour_start + 600, online=False, signal_bars=1)
    svc = fresh_service()
    svc._compact_old_readings()
    rows = rows_for("connectivity")
    check("boolean state is taken from the last reading, not averaged", rows and rows[0][2]["online"] is False)

    print("\n=== 8. PRUNE STILL DELETES BEYOND RETENTION AFTER COMPACTING ===")
    reset_db()
    ancient = now - (35 * 86400)  # older than the 30-day default retention
    insert("battery", "smartshunt", ancient, soc_pct=10.0)
    insert("battery", "smartshunt", now - 60, soc_pct=80.0)
    svc = fresh_service()
    svc._prune()
    rows = rows_for("battery")
    check("a reading past the retention window is gone after _prune()", len(rows) == 1)
    check("a recent reading survives", rows[0][2]["soc_pct"] == 80.0)

    print("\n=== 9. THE API ROUTE'S QUERY PATH STILL WORKS ACROSS THE COMPACTION BOUNDARY ===")
    reset_db()
    old_hour = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    for i in range(10):
        insert("battery", "smartshunt", old_hour + i * 60, soc_pct=40.0 + i)
    for i in range(5):
        insert("battery", "smartshunt", now - i * 60, soc_pct=80.0)
    svc = fresh_service()
    svc._compact_old_readings()
    # This is the exact call app/api/routes/telemetry.py's get_history()
    # makes - going through the query() a caller actually uses, not
    # reaching into internals.
    queried = svc.query("battery", since_timestamp=old_enough - 3600)
    check("compacted-old + full-resolution-recent both come back", len(queried) == 1 + 5)
    timestamps = [r["timestamp"] for r in queried]
    check("results stay in chronological order across the boundary", timestamps == sorted(timestamps))
    check("max_points downsampling still works on the now-smaller set", len(svc.query("battery", since_timestamp=old_enough - 3600, max_points=3)) <= 3)

    print("\n=== 10. THE PRUNE LOOP ACTUALLY RUNS OFF-THREAD WITHOUT CRASHING ===")
    reset_db()
    old_hour = int(old_enough // COMPACTION_BUCKET_SECONDS) * COMPACTION_BUCKET_SECONDS
    for i in range(10):
        insert("battery", "smartshunt", old_hour + i * 60, soc_pct=55.0)
    svc = fresh_service()
    task = asyncio.create_task(svc._prune_loop())
    await asyncio.sleep(0.5)  # let the first iteration's asyncio.to_thread(self._prune) complete
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    rows = rows_for("battery")
    check("a real asyncio.to_thread prune cycle compacted the backlog", len(rows) == 1)
    check("the prune loop ran and returned control to the event loop cleanly (no crash)", True)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All history compaction tests passed.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        os.unlink(_tmp_db.name)
