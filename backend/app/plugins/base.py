"""
Plugin interface.

Every data source — SimulationPlugin today, VictronPlugin / BatteryShuntPlugin
/ GPSPlugin / InternetMonitorPlugin later — implements this ABC. The rest of
the system (bus, API, frontend) only ever depends on this interface, never
on a concrete plugin.

A plugin's only job is: read/derive data, publish TelemetryMessages onto
the bus. It must NOT know about FastAPI, WebSockets, or React.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from enum import Enum

from app.telemetry.bus import TelemetryBus

logger = logging.getLogger("vanos.plugins")


class PluginStatus(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    ERROR = "error"


class Plugin(ABC):
    """Base class for all VanOS data-source plugins."""

    #: Unique, stable identifier — used in logs, health checks, and the
    #: Settings page plugin list. e.g. "simulation", "victron_mppt".
    name: str = "unnamed_plugin"

    #: Human-readable label for the UI.
    display_name: str = "Unnamed Plugin"

    def __init__(self, bus: TelemetryBus) -> None:
        self.bus = bus
        self.status: PluginStatus = PluginStatus.STOPPED

    @abstractmethod
    async def start(self) -> None:
        """Begin producing telemetry. Should set self.status and return
        once running (e.g. after spawning its own background task) —
        it should not block forever itself unless it manages its own
        asyncio.Task internally.
        """
        raise NotImplementedError

    @abstractmethod
    async def stop(self) -> None:
        """Cleanly stop producing telemetry and release any resources."""
        raise NotImplementedError

    def health(self) -> dict[str, str]:
        """Lightweight status info surfaced on /api/health and Settings."""
        return {"name": self.name, "display_name": self.display_name, "status": self.status.value}


class PluginRegistry:
    """Tracks active plugins so /api/health and the Settings page can
    report on them, and so plugins can be started/stopped as a group.
    """

    def __init__(self) -> None:
        self._plugins: dict[str, Plugin] = {}

    def register(self, plugin: Plugin) -> None:
        self._plugins[plugin.name] = plugin

    async def start_all(self) -> None:
        for plugin in self._plugins.values():
            logger.info("Starting plugin: %s", plugin.name)
            await plugin.start()

    async def stop_all(self) -> None:
        for plugin in self._plugins.values():
            logger.info("Stopping plugin: %s", plugin.name)
            await plugin.stop()

    def health(self) -> list[dict[str, str]]:
        return [p.health() for p in self._plugins.values()]


registry = PluginRegistry()
