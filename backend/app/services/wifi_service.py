"""
WifiService — scan for and connect to WiFi networks.

Talks to NetworkManager via `nmcli`. The backend container already runs
with network_mode: host and mounts /var/run/dbus (both needed for the
Victron Bluetooth plugin), which is also exactly what nmcli needs to
control the host's networking — so no additional container privileges
are required beyond installing the nmcli binary itself.

Security note: `wifi_control_lan_only` in the "general" config section
restricts these operations to requests originating from a private
network, so WiFi can't be reconfigured by anyone who reaches the
dashboard through a public tunnel. Defaults to False (open) - flip it
to True in Settings → config, or via:
  curl -X PUT http://localhost:8000/api/config/general \
    -H 'Content-Type: application/json' \
    -d '{"value": {"wifi_control_lan_only": true}}'

All subprocess calls pass arguments as a list (never shell=True), so
SSIDs and passwords containing shell metacharacters can't be used for
command injection.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger("vanos.wifi_service")

NMCLI_TIMEOUT_SECONDS = 45


class WifiUnavailableError(RuntimeError):
    """Raised when nmcli/NetworkManager isn't usable on this system."""


class WifiService:
    async def _run(self, *args: str) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                "nmcli",
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as e:
            raise WifiUnavailableError(
                "nmcli not found — this system may not use NetworkManager, "
                "or the backend image is missing the network-manager package"
            ) from e

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=NMCLI_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as e:
            process.kill()
            raise WifiUnavailableError(f"nmcli timed out after {NMCLI_TIMEOUT_SECONDS}s") from e

        if process.returncode != 0:
            message = stderr.decode(errors="replace").strip() or "unknown nmcli error"
            raise WifiUnavailableError(message)

        return stdout.decode(errors="replace")

    async def status(self) -> dict[str, Any]:
        """Currently active WiFi connection, if any."""
        output = await self._run("-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list")
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) >= 3 and parts[0] == "yes":
                return {
                    "connected": True,
                    "ssid": parts[1],
                    "signal": self._to_int(parts[2]),
                    "ip": await self._primary_ip(),
                }
        return {"connected": False, "ssid": None, "signal": None, "ip": None}

    async def _primary_ip(self) -> str | None:
        """IPv4 address of the connected WiFi device, for display in
        Settings. Best-effort: any failure just yields None rather than
        breaking the whole status call.
        """
        try:
            output = await self._run(
                "-t", "-f", "DEVICE,TYPE,STATE,IP4.ADDRESS", "device", "show"
            )
        except WifiUnavailableError:
            return None
        # `device show` groups fields per device across multiple lines;
        # nmcli -t prints them as KEY:VALUE, so scan for the wifi device
        # that's connected and return its first IP4 address.
        connected_wifi = False
        for line in output.splitlines():
            key, _, value = line.partition(":")
            if key == "GENERAL.TYPE":
                connected_wifi = value == "wifi"
            elif key == "GENERAL.STATE":
                connected_wifi = connected_wifi and "connected" in value
            elif key.startswith("IP4.ADDRESS") and connected_wifi and value:
                return value.split("/")[0]  # strip the /prefix length
        return None

    async def scan(self) -> list[dict[str, Any]]:
        """Available networks, strongest first, de-duplicated by SSID."""
        output = await self._run("-t", "-f", "SSID,SIGNAL,SECURITY,ACTIVE", "device", "wifi", "list", "--rescan", "yes")

        networks: dict[str, dict[str, Any]] = {}
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) < 4:
                continue
            ssid, signal, security, active = parts[0], parts[1], parts[2], parts[3]
            if not ssid:
                continue  # hidden network, nothing to show or connect to by name

            entry = {
                "ssid": ssid,
                "signal": self._to_int(signal),
                "secured": bool(security and security != "--"),
                # `current` (not `active`) is the field name the frontend
                # reads - see WifiNetwork in frontend/src/lib/types.ts.
                "current": active == "yes",
            }
            # Same SSID can appear once per access point - keep the strongest.
            existing = networks.get(ssid)
            if existing is None or (entry["signal"] or 0) > (existing["signal"] or 0):
                networks[ssid] = entry

        return sorted(networks.values(), key=lambda n: n["signal"] or 0, reverse=True)

    async def known_networks(self) -> list[str]:
        """SSIDs with saved credentials — these reconnect without a password."""
        output = await self._run("-t", "-f", "NAME,TYPE", "connection", "show")
        names = []
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) >= 2 and "wireless" in parts[1]:
                names.append(parts[0])
        return names

    async def connect(self, ssid: str, password: str | None = None) -> dict[str, Any]:
        args = ["device", "wifi", "connect", ssid]
        if password:
            args += ["password", password]
        await self._run(*args)
        return await self.status()

    @staticmethod
    def _split_terse(line: str) -> list[str]:
        """nmcli -t escapes literal colons as '\\:' — split on unescaped ones only."""
        parts: list[str] = []
        current = ""
        escaped = False
        for char in line:
            if escaped:
                current += char
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == ":":
                parts.append(current)
                current = ""
            else:
                current += char
        parts.append(current)
        return parts

    @staticmethod
    def _to_int(value: str) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


wifi_service = WifiService()
