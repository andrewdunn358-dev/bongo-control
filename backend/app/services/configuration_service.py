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
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger("vanos.config_service")

DEFAULT_CONFIG: dict[str, Any] = {
    "general": {},
    "appearance": {},
    "hardware": {},
    "location": {},
    # Relay board wiring. This van's 8-channel board is HIGH-TRIGGER
    # (opto input, no VCC pin - it self-powers from 12V and the Pi shares
    # its ground), confirmed against the real hardware: gpiozero drives
    # the pin HIGH to energise a circuit and LOW to release it. Channels
    # are named to the loads they switch; rename live from Settings if
    # any are wrong.
    # NOTE: with a HIGH-trigger board the pins must be forced LOW at boot
    # via /boot/firmware/config.txt (`gpio=17,27,22,23,16,26,12,13=op,dl`),
    # otherwise every circuit could energise during the boot window before
    # this service claims the pins. See relay_service.py.
    # NOTE: the `active_high` value below is NOT actually read by
    # relay_service.py at runtime - it hardcodes True independently (see
    # RelayService.__init__/configure). Kept here matching reality so
    # anyone reading just this file isn't misled, but if the real board's
    # trigger polarity ever needs to change, relay_service.py is the
    # place that actually has to change, not this value.
    "relays": {
        "active_high": True,
        "channels": [
            {"id": 1, "gpio": 17, "name": "Heater"},
            {"id": 2, "gpio": 27, "name": "Lights"},
            {"id": 3, "gpio": 22, "name": "Radio / amp"},
            {"id": 4, "gpio": 23, "name": "Fridge / TV"},
            # Roof reversing bridge - owned by RoofService, not a plain
            # switch. See roof_service.py and the "roof" section below.
            # Relay 8 is GPIO 26, not 25 - physical pin 22 (GPIO25) tested
            # dead on the actual hardware (good wire, good relay channel,
            # pin itself just didn't do anything), so it moved to pin 37.
            {"id": 7, "gpio": 16, "name": "Roof up"},
            {"id": 8, "gpio": 26, "name": "Roof down"},
            # Isolates the OEM switch's two signal wires from the ECU
            # for the duration of a hold - one relay per wire, since
            # isolating only one leaves the switch's dynamic-brake
            # bridge fully intact via the other. See isolate_channels
            # in the "roof" section below and roof_service.py.
            {"id": 5, "gpio": 12, "name": "Roof switch isolate A"},
            # Confirmed 2 Aug 2026 - not yet physically wired, but this
            # is the pin it's going on (physical pin 33).
            {"id": 6, "gpio": 13, "name": "Roof switch isolate B"},
        ],
    },
    # Enabled by explicit request, to test relays 7/8 as they're wired.
    # RoofService.configured additionally requires both channels to be
    # set (they are, above) - that double condition exists so a fresh
    # install or a bad config merge can never drive a roof motor
    # unasked; it doesn't mean this has to stay off once you've decided
    # to test it. Hitting up/down before the motor leads are actually
    # connected just energises an idle relay coil - same as bench-
    # testing any other channel before its load is wired.
    "roof": {
        "enabled": True,
        "up_channel": 7,
        "down_channel": 8,
        # Breaks the OEM switch's dynamic-brake bridge for the duration
        # of a hold, then reconnects it - see the isolate_channels note
        # in roof_service.py. Relay 5/GPIO 12 wired 1 Aug 2026; relay
        # 6/GPIO 13 is a placeholder pending confirmation of the actual
        # GPIO it's wired to.
        "isolate_channels": [5, 6],
    },
    # Simulation is on by default (nothing to configure); Victron starts
    # disabled until an encryption_key is set - see docs/victron_ble_integration.md.
    # This is also how switching between them works with zero code
    # changes: disable one, configure + enable the other.
    # Weather needs neither a key nor a location set (it auto-detects one
    # via IP if none exists) so, unlike Victron, there's no reason to hold
    # it off by default.
    "plugins": {
        "simulation": {"enabled": True},
        "victron_mppt": {"enabled": False},
        "weather": {"enabled": True},
    },
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
                # Deep-merge the plugins section specifically: a stored
                # `plugins` dict would otherwise fully shadow the defaults,
                # so a plugin later added to DEFAULT_CONFIG would never
                # appear for an existing install. Stored per-plugin settings
                # still win over the defaults.
                loaded_plugins = loaded.get("plugins")
                merged["plugins"] = {
                    **DEFAULT_CONFIG.get("plugins", {}),
                    **(loaded_plugins if isinstance(loaded_plugins, dict) else {}),
                }
                return merged
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load config file (%s), using defaults", e)
        return dict(DEFAULT_CONFIG)

    def _save(self) -> None:
        """Atomic write: serialise to a temp file in the same directory,
        fsync, then os.replace() into place. A van loses power abruptly;
        a plain truncate-then-write can leave a half-written, invalid
        config.json — which _load() would then discard, silently wiping
        auth tokens, plugin secrets and relay names and re-enabling the
        simulation plugin over real hardware. os.replace is atomic on
        POSIX, so a reader ever sees either the old file or the new one,
        never a truncated one.
        """
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        with open(tmp, "w") as f:
            json.dump(self._data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._path)

    def get(self, section: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(section, default)

    def set(self, section: str, value: Any) -> None:
        with self._lock:
            self._data[section] = value
            self._save()

    def user_agent(self, app_name: str = "VanOS", version: str = "1.0") -> str:
        """User-Agent for outbound requests to OpenStreetMap / Nominatim,
        built from the operator's own contact email (Settings → General),
        NOT hardcoded to anyone's personal repo. OSM's usage policy wants
        a real contact; until one is set we send a clearly-unset marker
        rather than leaking any identity.
        """
        contact = (self.get("general", {}) or {}).get("contact_email")
        contact = contact.strip() if isinstance(contact, str) else ""
        suffix = contact if contact else "no contact configured"
        return f"{app_name}/{version} (campervan dashboard; {suffix})"

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

    def update_plugin_config(self, plugin_name: str, partial: dict[str, Any]) -> dict[str, Any]:
        """Merges `partial` into the plugin's existing config rather than
        replacing it wholesale - so setting e.g. encryption_key doesn't
        accidentally clobber the enabled flag or other fields.
        """
        with self._lock:
            plugins = self._data.setdefault("plugins", {})
            plugin_conf = plugins.setdefault(plugin_name, {})
            plugin_conf.update(partial)
            self._save()
            return dict(plugin_conf)


configuration_service = ConfigurationService()
