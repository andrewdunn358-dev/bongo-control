"""
ConfigurationService — centralizes configuration for the app, plugins,
and the Settings framework's sections (general/appearance/hardware/
notifications/developer).

Backed by a single JSON file rather than SQLite (SQLite logging is an
explicit non-goal for this sprint) — this is configuration, not
telemetry history, so a small file is the right amount of machinery.
Every plugin's enable/disable state lives here, which is what lets the
Plugin Manager persist that across restarts.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger("vanos.config_service")

DEFAULT_CONFIG: dict[str, Any] = {
    "general": {},
    "appearance": {},
    "hardware": {},
    "plugins": {},  # plugin_name -> {"enabled": bool, **plugin-specific config}
    "notifications": {"enabled": True},
    "developer": {},
}


class ConfigurationService:
    def __init__(self, path: str = "data/config.json") -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        if self._path.exists():
            try:
                with open(self._path) as f:
                    loaded = json.load(f)
                # Merge with defaults so newly-added sections appear
                # without wiping an existing config file.
                merged = {**DEFAULT_CONFIG, **loaded}
                return merged
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load config file (%s), using defaults", e)
        return dict(DEFAULT_CONFIG)

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(self._data, f, indent=2)

    def get(self, section: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(section, default)

    def set(self, section: str, value: Any) -> None:
        with self._lock:
            self._data[section] = value
            self._save()

    def get_plugin_config(self, plugin_name: str) -> dict[str, Any]:
        with self._lock:
            return dict(self._data.get("plugins", {}).get(plugin_name, {}))

    def is_plugin_enabled(self, plugin_name: str, default: bool = True) -> bool:
        return self.get_plugin_config(plugin_name).get("enabled", default)

    def set_plugin_enabled(self, plugin_name: str, enabled: bool) -> None:
        with self._lock:
            plugins = self._data.setdefault("plugins", {})
            plugin_conf = plugins.setdefault(plugin_name, {})
            plugin_conf["enabled"] = enabled
            self._save()


configuration_service = ConfigurationService()
