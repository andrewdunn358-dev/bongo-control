"""
Plugin interface.

Every data source — SimulationPlugin today, VictronPlugin / BatteryShuntPlugin
/ GPSPlugin / InternetMonitorPlugin later — implements this ABC. The rest of
the system (bus, API, frontend) only ever depends on this interface, never
on a concrete plugin.

A plugin's only job is: read/derive data, publish TelemetryMessages onto
the bus. It must NOT know about FastAPI, WebSockets, or React.

Sprint 4 additions: version reporting, heartbeat tracking, and error
state, so the Plugin Manager / Plugin Status Page can show real health
information instead of just a status enum.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from app.telemetry.bus import TelemetryBus

logger = logging.getLogger("vanos.plugins")


class PluginStatus(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    ERROR = "error"
    DISABLED = "disabled"


class Plugin(ABC):
    """Base class for all VanOS data-source plugins."""

    #: Unique, stable identifier — used in logs, health checks, and the
    #: Plugin Status page. e.g. "simulation", "victron_mppt".
    name: str = "unnamed_plugin"

    #: Human-readable label for the UI.
    display_name: str = "Unnamed Plugin"

    #: Plugin version — independent of the app version, so individual
    #: plugins (especially hardware ones added later) can be versioned
    #: and upgraded on their own.
    version: str = "0.1.0"

    def __init__(self, bus: TelemetryBus) -> None:
        self.bus = bus
        self.status: PluginStatus = PluginStatus.STOPPED
        self.last_heartbeat: float | None = None
        self.last_error: str | None = None
        self.config: dict[str, Any] = {}

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

    def configure(self, config: dict[str, Any]) -> None:
        """Apply plugin-specific configuration (from ConfigurationService).
        Default no-op — plugins override this if they have tunable
        settings (e.g. tick interval, connection details). Called before
        start().
        """
        self.config = config

    def heartbeat(self) -> None:
        """Plugins call this on every successful tick/reading so the
        Plugin Manager can show 'last update' and detect stalled plugins.
        """
        self.last_heartbeat = time.time()

    def record_error(self, message: str) -> None:
        """Plugins call this when something goes wrong without being
        fatal enough to stop the plugin entirely (fatal errors should
        set status = ERROR and re-raise, per the existing _run() pattern).
        """
        self.last_error = message
        logger.warning("Plugin %s reported error: %s", self.name, message)

    def health(self) -> dict[str, Any]:
        """Full status info surfaced on /api/plugins and the Plugin
        Status page.
        """
        return {
            "name": self.name,
            "display_name": self.display_name,
            "version": self.version,
            "status": self.status.value,
            "last_heartbeat": self.last_heartbeat,
            "last_error": self.last_error,
        }
