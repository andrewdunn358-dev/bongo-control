"""
Simulation Plugin.

Produces realistic-feeling telemetry for every domain every tick, so the
full frontend can be built and demoed before any hardware exists. It
publishes onto the TelemetryBus exactly like a real hardware plugin
would (VictronPlugin, BatteryShuntPlugin, ...) — same message shape,
same domains. The frontend never knows the difference.

Model summary (deliberately simple but directionally realistic):
- Solar irradiance follows a sine curve across daylight hours, modulated
  by a slowly-drifting "cloud cover" factor.
- Battery SoC integrates (solar_in - load_out) over time, clamped 0-100.
- Loads cycle a small set of appliances on/off on independent timers.
- Environment (temperature) follows a smooth day/night curve.
- Connectivity jitters signal strength and occasionally flips online/offline.
"""

from __future__ import annotations

import asyncio
import math
import random
import time

from app.plugins.base import Plugin, PluginStatus
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

TICK_SECONDS = 1.0


class SimulationState:
    """Mutable world state the engine evolves each tick."""

    def __init__(self) -> None:
        self.sim_start = time.time()
        self.battery_soc = 78.0  # percent
        self.battery_voltage = 12.9
        self.cloud_factor = 0.15  # 0 = clear sky, 1 = fully overcast
        self.loads: dict[str, bool] = {
            "fridge": True,
            "lighting": False,
            "diesel_heater": False,
            "water_pump": False,
        }
        self.online = True
        self.signal_strength = 78  # percent


def _solar_irradiance(elapsed_hours: float, cloud_factor: float) -> float:
    """Returns simulated solar output in watts, 0 at night, peaking
    midday, reduced by cloud cover. `elapsed_hours` is wall-clock hours
    since sim start, mapped onto a 24h cycle starting at 08:00 (i.e. we
    start the demo mid-morning so there's immediately something to see).
    """
    hour_of_day = (8 + elapsed_hours) % 24
    daylight = math.sin(math.pi * (hour_of_day - 6) / 12)
    daylight = max(0.0, daylight)  # zero at night
    peak_watts = 320.0
    return peak_watts * daylight * (1.0 - cloud_factor)


def _total_load_watts(loads: dict[str, bool]) -> float:
    wattage = {
        "fridge": 45.0,
        "lighting": 18.0,
        "diesel_heater": 120.0,
        "water_pump": 30.0,
    }
    return sum(wattage[name] for name, on in loads.items() if on)


class SimulationEngine(Plugin):
    name = "simulation"
    display_name = "Simulation Engine"
    version = "1.0.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self.state = SimulationState()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self.status = PluginStatus.STARTING
        self._task = asyncio.create_task(self._run())
        self.status = PluginStatus.RUNNING

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.status = PluginStatus.STOPPED

    async def _run(self) -> None:
        try:
            while True:
                await self._tick()
                await asyncio.sleep(TICK_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a plugin must never crash the app
            self.status = PluginStatus.ERROR
            raise

    async def _tick(self) -> None:
        s = self.state
        elapsed_hours = (time.time() - s.sim_start) / 3600.0

        # Slowly drift cloud cover
        s.cloud_factor = min(1.0, max(0.0, s.cloud_factor + random.uniform(-0.02, 0.02)))

        solar_watts = _solar_irradiance(elapsed_hours, s.cloud_factor)

        # Randomly toggle loads occasionally for a "lived in" feel
        if random.random() < 0.01:
            load_name = random.choice(list(s.loads.keys()))
            if load_name != "fridge":  # fridge stays on
                s.loads[load_name] = not s.loads[load_name]

        load_watts = _total_load_watts(s.loads)

        # Integrate battery state: net watts over one tick, rough 100Ah/12.8V bank
        net_watts = solar_watts - load_watts
        bank_wh = 100 * 12.8
        delta_soc = (net_watts * (TICK_SECONDS / 3600.0) / bank_wh) * 100
        s.battery_soc = min(100.0, max(0.0, s.battery_soc + delta_soc))
        s.battery_voltage = 12.0 + (s.battery_soc / 100.0) * 1.6

        # Connectivity jitter
        s.signal_strength = min(100, max(0, s.signal_strength + random.randint(-3, 3)))
        if random.random() < 0.002:
            s.online = not s.online

        await self._publish_all(solar_watts, load_watts, elapsed_hours)
        self.heartbeat()

    async def _publish_all(self, solar_watts: float, load_watts: float, elapsed_hours: float) -> None:
        s = self.state
        now = time.time()

        async def emit(domain: TelemetryDomain, payload: dict) -> None:
            await self.bus.publish(
                TelemetryMessage(
                    domain=domain,
                    source=TelemetrySource.SIMULATION,
                    timestamp=now,
                    payload=payload,
                )
            )

        await emit(
            TelemetryDomain.SOLAR,
            {
                "watts": round(solar_watts, 1),
                "cloud_cover_pct": round(s.cloud_factor * 100, 0),
                "peak_today_watts": 320.0,
            },
        )

        await emit(
            TelemetryDomain.BATTERY,
            {
                "soc_pct": round(s.battery_soc, 1),
                "voltage": round(s.battery_voltage, 2),
                "charging": solar_watts > load_watts,
            },
        )

        await emit(
            TelemetryDomain.ENERGY,
            {
                "solar_watts": round(solar_watts, 1),
                "load_watts": round(load_watts, 1),
                "net_watts": round(solar_watts - load_watts, 1),
                "loads": dict(s.loads),
            },
        )

        # Runtime predictions in plain English — the "Power Budget" concept
        bank_wh_remaining = (s.battery_soc / 100.0) * 100 * 12.8
        fridge_only_hours = (
            bank_wh_remaining / _total_load_watts({"fridge": True, "lighting": False, "diesel_heater": False, "water_pump": False})
            if s.loads.get("fridge")
            else float("inf")
        )
        await emit(
            TelemetryDomain.SYSTEM,
            {
                "power_budget": {
                    "heater_all_night_possible": bank_wh_remaining > 120 * 8,
                    "estimated_runtime_hours": round(min(fridge_only_hours, 999), 1),
                    "estimated_recovery_tomorrow_pct": round(min(100.0, s.battery_soc + 35), 0),
                }
            },
        )

        temp_c = 12 + 8 * math.sin(math.pi * ((elapsed_hours + 8) % 24 - 6) / 12)
        await emit(
            TelemetryDomain.ENVIRONMENT,
            {
                "internal_temp_c": round(temp_c + 4, 1),
                "external_temp_c": round(temp_c, 1),
                "humidity_pct": 55,
            },
        )

        await emit(
            TelemetryDomain.CONNECTIVITY,
            {
                "online": s.online,
                "signal_strength_pct": s.signal_strength,
                "connection_type": "4g_hotspot",
            },
        )
