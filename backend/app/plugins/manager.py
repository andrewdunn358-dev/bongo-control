"""
PluginManager — discovers, starts/stops, enables/disables plugins, and
reports health. Replaces the simpler PluginRegistry from Sprint 1 with
the fuller lifecycle Sprint 4 asks for, while keeping the same
fundamental idea: a central place that owns every Plugin instance.

Discovery is real, not a hardcoded list: it scans `app/plugins/` for
subpackages exposing a `PLUGIN_CLASSES` list (see
`app/plugins/simulation/__init__.py` for the convention). Adding a real
hardware plugin later (Victron, battery shunt, ...) means dropping a
new package in `app/plugins/` — no changes needed here or in main.py.

    Plugins ──publish──▶ TelemetryBus ◀── TelemetryService ◀── (routes)
        ▲
        └── started/stopped/enabled/disabled by PluginManager,
            which persists enable/disable state via ConfigurationService
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Any

from app.plugins.base import Plugin, PluginStatus
from app.services.configuration_service import ConfigurationService
from app.services.notification_service import NotificationService
from app.telemetry.bus import TelemetryBus

logger = logging.getLogger("vanos.plugin_manager")


class PluginManager:
    def __init__(
        self,
        bus: TelemetryBus,
        configuration_service: ConfigurationService,
        notification_service: NotificationService | None = None,
    ) -> None:
        self._bus = bus
        self._config = configuration_service
        self._notifications = notification_service
        self._plugins: dict[str, Plugin] = {}

    def discover(self) -> list[type[Plugin]]:
        """Scans app/plugins/* subpackages for a `PLUGIN_CLASSES` list.
        Returns the discovered classes; does not instantiate them.
        """
        discovered: list[type[Plugin]] = []
        import app.plugins as plugins_pkg

        for _finder, name, is_pkg in pkgutil.iter_modules(plugins_pkg.__path__):
            if not is_pkg:
                continue  # skip base.py/manager.py, only look at plugin subpackages
            try:
                module = importlib.import_module(f"app.plugins.{name}")
            except Exception as e:  # noqa: BLE001 - a broken plugin package must not crash discovery
                logger.warning("Failed to import plugin package '%s': %s", name, e)
                continue

            classes = getattr(module, "PLUGIN_CLASSES", [])
            discovered.extend(classes)

        return discovered

    def discover_and_register(self) -> None:
        for plugin_class in self.discover():
            instance = plugin_class(self._bus)
            self.register(instance)

    def register(self, plugin: Plugin) -> None:
        plugin.configure(self._config.get_plugin_config(plugin.name))
        self._plugins[plugin.name] = plugin
        logger.info("Registered plugin: %s v%s", plugin.name, plugin.version)

    def get(self, name: str) -> Plugin | None:
        return self._plugins.get(name)

    async def start_all(self) -> None:
        """Starts every registered plugin that isn't disabled in config."""
        for plugin in self._plugins.values():
            if not self._config.is_plugin_enabled(plugin.name, default=True):
                plugin.status = PluginStatus.DISABLED
                logger.info("Plugin '%s' is disabled, not starting", plugin.name)
                continue
            await self._start_one(plugin)

    async def stop_all(self) -> None:
        for plugin in self._plugins.values():
            if plugin.status in (PluginStatus.RUNNING, PluginStatus.STARTING):
                await self._stop_one(plugin)

    async def _start_one(self, plugin: Plugin) -> None:
        logger.info("Starting plugin: %s", plugin.name)
        try:
            await plugin.start()
            if self._notifications:
                await self._notifications.plugin_connected(plugin.display_name)
        except Exception as e:  # noqa: BLE001 - one plugin failing to start must not crash the app
            plugin.status = PluginStatus.ERROR
            plugin.record_error(str(e))
            if self._notifications:
                await self._notifications.plugin_error(plugin.display_name, str(e))

    async def _stop_one(self, plugin: Plugin) -> None:
        logger.info("Stopping plugin: %s", plugin.name)
        await plugin.stop()
        if self._notifications:
            await self._notifications.plugin_disconnected(plugin.display_name)

    async def enable(self, name: str) -> bool:
        plugin = self._plugins.get(name)
        if not plugin:
            return False
        self._config.set_plugin_enabled(name, True)
        if plugin.status != PluginStatus.RUNNING:
            await self._start_one(plugin)
        return True

    async def disable(self, name: str) -> bool:
        plugin = self._plugins.get(name)
        if not plugin:
            return False
        self._config.set_plugin_enabled(name, False)
        if plugin.status in (PluginStatus.RUNNING, PluginStatus.STARTING):
            await self._stop_one(plugin)
        plugin.status = PluginStatus.DISABLED
        return True

    def health(self) -> list[dict[str, Any]]:
        return [
            {**p.health(), "enabled": self._config.is_plugin_enabled(p.name, default=True)} for p in self._plugins.values()
        ]
