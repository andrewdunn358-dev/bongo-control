"""
SolarYieldSignalProvider — a front-page verdict on today's solar:
is it good, normal or low *for this time of year*?

The trap with "for this time of year" is that it sounds like it needs a
year of history to know what's normal in, say, late July. It doesn't.
The seasonal ceiling is pure sun geometry — a function of latitude and
day-of-year only — so a clear-sky day's maximum solar energy can be
computed from first principles (FAO-56 extraterrestrial radiation Ra,
then Rso = 0.75*Ra at ~sea level for the clear-sky global horizontal
figure). Today's actual, cloud-adjusted figure comes straight from the
weather forecast the app already fetches: `shortwave_radiation_sum`
(MJ/m²/day, global horizontal) — directly comparable to Rso.

Comparing the two answers the question honestly and from day one:
  ratio = today_forecast / clear_sky_ceiling
A low ratio in December is judged against December's (low) ceiling, so a
short overcast winter day reads as "normal", while a dull day under a
clear-sky-capable sky reads as "low — you should be harvesting more".

Actual harvest (`yield_today_wh`, which the Victron charger reports and
the simulation doesn't) is shown factually alongside. A precise
panel-performance-vs-expected number (actual Wh vs a self-calibrated
model of the array) is a deliberate v2: it needs either a configured
array rating or a few days of the van's own (yield, radiation) history
to learn the Wh-per-MJ conversion. This v1 doesn't fake that precision.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from app.intelligence.signals import Signal, SignalSeverity
from app.telemetry.models import TelemetryDomain

GSC_MJ_PER_M2_MIN = 0.0820  # solar constant, FAO-56 units
CLEAR_SKY_COEFF = 0.75  # Rso = 0.75 * Ra at ~sea level (FAO-56)

# Thresholds on (today's forecast / clear-sky ceiling).
GOOD_RATIO = 0.75
NORMAL_RATIO = 0.45


def clear_sky_daily_mj(latitude_deg: float, day_of_year: int) -> float:
    """Clear-sky daily global horizontal solar energy (MJ/m²) for a
    latitude and day-of-year, via the FAO-56 Ra formula. Latitude-and-
    date only — no weather, no history — which is exactly what makes it
    a valid 'what's possible this time of year' yardstick.
    """
    phi = math.radians(latitude_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi / 365 * day_of_year)
    decl = 0.409 * math.sin(2 * math.pi / 365 * day_of_year - 1.39)
    # Sunset hour angle; clamp the argument so polar day/night (|arg|>1)
    # doesn't blow up acos.
    x = max(-1.0, min(1.0, -math.tan(phi) * math.tan(decl)))
    ws = math.acos(x)
    ra = (24 * 60 / math.pi) * GSC_MJ_PER_M2_MIN * dr * (
        ws * math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.sin(ws)
    )
    return CLEAR_SKY_COEFF * max(0.0, ra)


class SolarYieldSignalProvider:
    def __init__(self, telemetry_service, location_service) -> None:
        self._telemetry = telemetry_service
        self._location = location_service

    def evaluate(self) -> Signal | None:
        weather = self._telemetry.latest(TelemetryDomain.WEATHER)
        if weather is None:
            return None  # weather plugin not running - nothing to say
        today_mj = weather.payload.get("today", {}).get("shortwave_radiation_sum_mj")
        if today_mj is None:
            return None

        solar = self._telemetry.latest(TelemetryDomain.SOLAR)
        yield_wh = solar.payload.get("yield_today_wh") if solar else None
        yield_txt = f"; {round(yield_wh)} Wh harvested so far" if yield_wh is not None else ""

        lat = (self._location.get() or {}).get("latitude")
        if lat is None:
            # No location => can't compute the seasonal ceiling. Report
            # the forecast + harvest factually rather than guessing.
            return Signal(
                source="solar_verdict",
                severity=SignalSeverity.UNKNOWN,
                message=f"Solar forecast today is {today_mj:.1f} MJ/m²{yield_txt}. Set your location for a seasonal verdict.",
                weight=1,
                detail={"today_mj": round(today_mj, 1), "yield_today_wh": round(yield_wh) if yield_wh is not None else None},
            )

        doy = datetime.now(timezone.utc).timetuple().tm_yday
        clearsky = clear_sky_daily_mj(lat, doy)
        if clearsky <= 0:
            return Signal(
                source="solar_verdict",
                severity=SignalSeverity.UNKNOWN,
                message=f"Barely any daylight at this latitude right now{yield_txt}.",
                weight=1,
                detail={"today_mj": round(today_mj, 1), "clearsky_mj": round(clearsky, 1),
                        "yield_today_wh": round(yield_wh) if yield_wh is not None else None},
            )

        ratio = today_mj / clearsky
        pct = round(ratio * 100)
        if ratio >= GOOD_RATIO:
            verdict, severity = "good", SignalSeverity.OK
            base = f"Good solar day for the season — bright skies, about {pct}% of the most a clear day could give right now"
        elif ratio >= NORMAL_RATIO:
            verdict, severity = "normal", SignalSeverity.OK
            base = f"Normal solar for the season — some cloud about, roughly {pct}% of a clear day"
        else:
            verdict, severity = "low", SignalSeverity.WARNING
            base = f"Low solar today — heavy cloud, only about {pct}% of what a clear day this time of year would give"

        base += f". A clear day now tops out near {clearsky:.0f} MJ/m²{yield_txt}."

        return Signal(
            source="solar_verdict",
            severity=severity,
            message=base,
            weight=1,
            detail={
                "verdict": verdict,
                "ratio_pct": pct,
                "today_mj": round(today_mj, 1),
                "clearsky_mj": round(clearsky, 1),
                "yield_today_wh": round(yield_wh) if yield_wh is not None else None,
            },
        )
