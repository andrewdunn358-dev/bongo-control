"""
Hcalory diesel heater plugin — reads from the host-side agent.

CONTAINS NO BLUETOOTH CODE, deliberately.

The backend container runs a continuous BLE discovery scan for the
Victron MPPT and SmartShunt. BlueZ permits one discovery session per
adapter, so a GATT connect from the same process collided with it:

    [org.bluez.Error.InProgress] Operation already in progress

Pausing the shared scan around the connect was tried and was worse -
BlueZ then reported "No Bluetooth adapters found", putting the Victron
plugins at risk. Battery and solar monitoring matter more than the
heater, so the heater moved out rather than the other way round.

The Bluetooth link now lives in `tools/heater_agent.py`, a systemd
service on the Pi host with its own process and its own BlueZ session.
This plugin just polls it over local HTTP. Consequences worth knowing:

  * Nothing the heater does can disturb the Victron plugins. If the
    agent dies, this reports the heater unavailable and nothing else
    changes.
  * The heater's safety guards live in the agent, not here, because the
    agent is the only thing that can actually reach the heater.
  * If the agent is not installed, this plugin reports that plainly
    rather than looking broken.

The host was also the arrangement that demonstrably worked: the
standalone test connected first time from there, repeatedly, while the
container never managed it once.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.plugins.base import Plugin, PluginStatus
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.hcalory_heater")

DEFAULT_AGENT = "http://127.0.0.1:8091"
DEFAULT_POLL_SECONDS = 10.0
# Short: the agent is on loopback. A slow answer means it is wedged,
# and waiting longer will not improve the reading.
REQUEST_TIMEOUT = 8.0
# Past this the agent's reading is old enough that reporting it as live
# would be a lie.
#
# Generous on purpose. This heater terminates the connection roughly
# every 6-19 seconds and the agent reconnects; `updated_at` only moves
# when a connection lands, so a threshold near the poll interval marks
# perfectly good data "stale" during every gap. At 120s it was firing
# constantly while a fresh reading was seconds away.
#
# 300s means: if nothing has been read in five minutes, something is
# genuinely wrong - not merely mid-reconnect.
STALE_AFTER = 300.0


class HcaloryHeaterPlugin(Plugin):
    name = "hcalory_heater"
    display_name = "Diesel Heater"
    version = "0.3.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._task: asyncio.Task | None = None
        self._agent: str = DEFAULT_AGENT
        self._poll_seconds: float = DEFAULT_POLL_SECONDS
        self._latest: dict[str, Any] = {}
        self._connected = False

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._agent = str(config.get("agent_url") or DEFAULT_AGENT).rstrip("/")
        try:
            self._poll_seconds = max(3.0, float(config.get("poll_seconds", DEFAULT_POLL_SECONDS)))
        except (TypeError, ValueError):
            self._poll_seconds = DEFAULT_POLL_SECONDS

    async def start(self) -> None:
        self.status = PluginStatus.STARTING
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.status = PluginStatus.STOPPED

    @property
    def latest(self) -> dict[str, Any]:
        return dict(self._latest)

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def agent_url(self) -> str:
        return self._agent

    async def _run(self) -> None:
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - the agent may not be installed or running
                self._connected = False
                self.status = PluginStatus.ERROR
                self.last_error = (
                    f"Can't reach the heater agent at {self._agent}. "
                    "It runs on the Pi host: `sudo systemctl status vanos-heater-agent`."
                )
                logger.debug("Heater agent unreachable: %s", e)

            await asyncio.sleep(self._poll_seconds)

    async def _poll_once(self) -> None:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(f"{self._agent}/state")
            response.raise_for_status()
            data = response.json()

        updated = float(data.get("updated_at") or 0)
        stale = updated > 0 and (time.time() - updated) > STALE_AFTER

        # Reachable-but-stale is its own state. The agent is alive and
        # answering while the heater has gone quiet - reporting that as
        # connected would show numbers that stopped being true minutes
        # ago.
        self._connected = bool(data.get("connected")) and not stale

        if not self._connected:
            self.status = PluginStatus.ERROR

            # The agent's own error is the accurate one. Prefer it over
            # anything invented here - it knows whether the heater hung
            # up, whether the adapter is missing, or whether it simply
            # has not reached it yet.
            agent_error = data.get("error")

            if stale:
                age = int(time.time() - updated)
                self.last_error = (
                    f"No reading from the heater for {age // 60} minutes. "
                    + (agent_error or "The agent is running but not reaching it.")
                )
            else:
                self.last_error = agent_error or "Connecting to the heater."

            # Reconnecting is normal for this heater, so the last known
            # values stay available rather than the UI blanking every
            # few seconds. The page labels them with their age.
            self._latest = {**self._latest, "connected": False, "updated_at": updated}
            return

        self.status = PluginStatus.RUNNING
        self.last_error = None
        self.last_heartbeat = time.time()

        payload = dict(data.get("state") or {})
        payload["connected"] = True
        payload["updated_at"] = updated
        self._latest = payload

        await self.bus.publish(
            TelemetryMessage(
                domain=TelemetryDomain.HEATING,
                source=TelemetrySource.HCALORY_HEATER,
                timestamp=time.time(),
                payload=payload,
            )
        )
