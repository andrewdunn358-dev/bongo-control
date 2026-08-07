"""
VoiceSummaryService — turns current telemetry into one plain-English
sentence, meant to be read aloud by a phone voice assistant.

Written for the ear, not the eye, which is a genuinely different
constraint from the rest of the app:

  - No units that sound wrong spoken. "12.9 volts", not "12.9V".
  - No abbreviations. "degrees", not "°C".
  - Rounded hard. "about 120 watts" is useful aloud; "118.4 watts"
    is noise you can't act on.
  - Short. Anything past two sentences and the listener has stopped
    following.

Honesty rules carry over unchanged. If a reading is missing it is
omitted from the sentence entirely rather than spoken as zero, and
battery is reported as VOLTAGE because this van has no shunt - saying
a percentage aloud would be inventing a number, and it'd be even more
convincing spoken than it is on screen.
"""

from __future__ import annotations

from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain


class VoiceSummaryService:
    def __init__(self, telemetry_service: TelemetryService) -> None:
        self._telemetry = telemetry_service

    def summary(self) -> dict[str, object]:
        parts: list[str] = []

        battery = self._telemetry.latest(TelemetryDomain.BATTERY)
        if battery is not None:
            payload = battery.payload
            soc = payload.get("soc_pct")
            voltage = payload.get("voltage")
            charging = payload.get("charging")

            if soc is not None:
                # Only reachable once a shunt is fitted. Left in so the
                # sentence improves automatically rather than needing a
                # rewrite later.
                state = "and charging" if charging else "and discharging"
                parts.append(f"Battery is at {round(soc)} percent {state}")
            elif voltage is not None:
                state = "and charging" if charging else "and not charging"
                # One decimal place: 12.88 spoken aloud is "twelve point
                # eight eight", which is a mouthful for no benefit.
                parts.append(f"Battery is at {voltage:.1f} volts {state}")

        solar = self._telemetry.latest(TelemetryDomain.SOLAR)
        if solar is not None:
            watts = solar.payload.get("watts")
            if watts is not None:
                if watts < 5:
                    parts.append("no solar coming in")
                else:
                    # Round to 10W - the difference between 118 and 120
                    # watts changes no decision anyone would make.
                    parts.append(f"solar is making about {round(watts / 10) * 10} watts")

        environment = self._telemetry.latest(TelemetryDomain.ENVIRONMENT)
        if environment is not None:
            inside = environment.payload.get("internal_temp_c")
            outside = environment.payload.get("external_temp_c")
            if inside is not None and outside is not None:
                parts.append(f"it's {round(inside)} degrees inside and {round(outside)} outside")
            elif inside is not None:
                parts.append(f"it's {round(inside)} degrees inside")
            elif outside is not None:
                parts.append(f"it's {round(outside)} degrees outside")

        if not parts:
            spoken = "No data from the van right now."
        else:
            spoken = self._join(parts) + "."

        return {
            "speech": spoken,
            # Structured alongside the sentence, so a shortcut can show
            # a card or drive a widget without re-parsing English.
            "battery_voltage": (battery.payload.get("voltage") if battery else None),
            "battery_soc_pct": (battery.payload.get("soc_pct") if battery else None),
            "charging": (battery.payload.get("charging") if battery else None),
            "solar_watts": (solar.payload.get("watts") if solar else None),
            "internal_temp_c": (environment.payload.get("internal_temp_c") if environment else None),
            "external_temp_c": (environment.payload.get("external_temp_c") if environment else None),
        }

    @staticmethod
    def _join(parts: list[str]) -> str:
        """Oxford-comma-free natural joining - "a, b and c" rather than
        "a, b, c", because the former is what a person would say.
        """
        if len(parts) == 1:
            return parts[0]
        return ", ".join(parts[:-1]) + " and " + parts[-1]
