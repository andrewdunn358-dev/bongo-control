"""
WifiService — scan for and connect to WiFi networks.

Talks to NetworkManager via `nmcli`. The backend container already runs
with network_mode: host and mounts /var/run/dbus (both needed for the
Victron Bluetooth plugin), which is also exactly what nmcli needs to
control the host's networking — so no additional container privileges
are required beyond installing the nmcli binary itself.

WiFi control works the same whether you're on the van's own network or
reaching the app remotely through the Cloudflare Tunnel - the app
password (require_app_token) is the only gate. An earlier LAN-only
restriction on top of that was removed: it silently blocked exactly the
remote-testing use case this app's tunnel exists for, with no clear
error, which did more harm than good.

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
        """Currently active WiFi connection, if any.

        Reads the wifi DEVICE's own state (`nmcli device status`), not
        the scan list. The scan list's ACTIVE flag only reflects
        NetworkManager's last *completed background scan* - if that scan
        is stale or hasn't run recently, the network the device is
        genuinely associated with can simply be missing from it, so the
        old scan-based check could report "not connected" for a device
        that very much was (this is what caused the Settings page's
        top-of-screen OFFLINE pill to show red while the app was live
        and serving telemetry over the same connection - it can't
        actually be offline if that's happening). Device state doesn't
        depend on scan freshness, so it's the authoritative source.
        """
        output = await self._run("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status")
        ssid: str | None = None
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) >= 4 and parts[1] == "wifi" and parts[2].startswith("connected"):
                ssid = parts[3] or None
                break

        if ssid is None:
            return {"connected": False, "ssid": None, "signal": None, "ip": None}

        return {
            "connected": True,
            "ssid": ssid,
            "signal": await self._signal_for_ssid(ssid),
            "ip": await self._primary_ip(),
        }

    async def _signal_for_ssid(self, ssid: str) -> int | None:
        """Best-effort signal strength for the display badge only - cosmetic,
        never used to decide connected/disconnected (see status() above)."""
        try:
            output = await self._run("-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list")
        except WifiUnavailableError:
            return None
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) >= 3 and parts[0] == "yes" and parts[1] == ssid:
                return self._to_int(parts[2])
        return None

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
                # NOT `"connected" in value` - "disconnected" contains
                # "connected" as a literal substring, so that check could
                # treat a disconnected device as connected. STATE values
                # look like "100 (connected)", so match the exact suffix.
                connected_wifi = connected_wifi and value.strip().endswith("(connected)")
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
