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

        # The scan's ACTIVE column goes stale the same way status() used to
        # (see its docstring): the network the adapter is actually on can
        # show as not-current. Take "current" from device state instead.
        try:
            connected_ssid = (await self.status()).get("ssid")
        except WifiUnavailableError:
            connected_ssid = None
        if connected_ssid:
            for entry in networks.values():
                entry["current"] = entry["ssid"] == connected_ssid

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
        """Join a network, including WPA3 and WPA2/WPA3 mixed-mode ones.

        The old one-liner (`nmcli device wifi connect SSID password PW`)
        leaves NetworkManager to guess the key-management type. Against a
        WPA3 or WPA2/WPA3 "transition mode" access point (the ZTE U50 5G
        MiFi's default, with no option to change it) that guess fails with
        "802-11-wireless-security.key-mgmt: property is missing". So for
        secured networks we build the profile explicitly with the right
        key-mgmt instead:

          WPA2 / WPA1 only  -> wpa-psk
          WPA3 only         -> sae (WPA3), PMF required
          WPA2 + WPA3 mixed -> wpa-psk first (works on any adapter),
                               falling back to sae if the AP refuses it

        The new profile is created under a temporary name and only takes
        over the SSID's name once it has actually connected, so a wrong
        password or unsupported adapter never destroys a working saved
        profile for that network.
        """
        if not password:
            if ssid in await self.known_networks():
                await self._run("connection", "up", "id", ssid)
            else:
                # Open network (or NM already knows it some other way).
                await self._run("device", "wifi", "connect", ssid)
            return await self.status()

        security = await self._security_for_ssid(ssid)
        attempts = self._key_mgmt_attempts(security)
        ifname = await self._wifi_device()

        errors: list[str] = []
        for key_mgmt in attempts:
            try:
                await self._connect_with_profile(ssid, password, key_mgmt, ifname)
                return await self.status()
            except WifiUnavailableError as e:
                logger.warning("WiFi connect to %r with key-mgmt %s failed: %s", ssid, key_mgmt, e)
                errors.append(f"{key_mgmt}: {e}")

        detail = "; ".join(errors)
        if "sae" in attempts:
            detail += (
                " — this network uses WPA3. If the password is correct, the WiFi "
                "adapter's driver may not support WPA3 (SAE)."
            )
        raise WifiUnavailableError(detail)

    async def _connect_with_profile(self, ssid: str, password: str, key_mgmt: str, ifname: str) -> None:
        temp_name = f"{ssid} (vanos-new)"
        await self._delete_profiles_named(temp_name)  # leftover from an interrupted attempt

        args = [
            "connection", "add",
            "type", "wifi",
            "ifname", ifname,
            "con-name", temp_name,
            "ssid", ssid,
            "wifi-sec.key-mgmt", key_mgmt,
            "wifi-sec.psk", password,
        ]
        if key_mgmt == "sae":
            args += ["wifi-sec.pmf", "required"]  # WPA3 mandates PMF
        await self._run(*args)

        try:
            await self._run("connection", "up", "id", temp_name)
        except WifiUnavailableError:
            await self._delete_profiles_named(temp_name)
            raise

        # Connected: retire any older profile for this SSID, then give the
        # new one the SSID as its name so Settings shows it as "saved".
        await self._delete_profiles_named(ssid)
        await self._run("connection", "modify", "id", temp_name, "connection.id", ssid)

    async def _delete_profiles_named(self, name: str) -> None:
        try:
            output = await self._run("-t", "-f", "NAME,UUID,TYPE", "connection", "show")
        except WifiUnavailableError:
            return
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) >= 3 and parts[0] == name and "wireless" in parts[2]:
                try:
                    await self._run("connection", "delete", "uuid", parts[1])
                except WifiUnavailableError as e:
                    logger.warning("Could not delete WiFi profile %r: %s", name, e)

    async def _security_for_ssid(self, ssid: str) -> str:
        """The SECURITY column nmcli reports for this SSID, e.g. 'WPA2 WPA3'.

        Tries the cached scan first (fast); rescans once if the SSID isn't
        in it. Empty string if the network can't be seen at all.
        """
        for rescan in ("no", "yes"):
            output = await self._run("-t", "-f", "SSID,SECURITY", "device", "wifi", "list", "--rescan", rescan)
            for line in output.splitlines():
                parts = self._split_terse(line)
                if len(parts) >= 2 and parts[0] == ssid:
                    return parts[1]
        return ""

    @staticmethod
    def _key_mgmt_attempts(security: str) -> list[str]:
        tokens = security.upper().split()
        has_wpa3 = "WPA3" in tokens or "SAE" in tokens
        has_wpa2 = "WPA2" in tokens or "WPA1" in tokens or "WPA" in tokens
        if has_wpa3 and not has_wpa2:
            return ["sae"]
        if has_wpa3 and has_wpa2:
            return ["wpa-psk", "sae"]
        # WPA2/WPA1, or not visible in the scan: WPA2 is the safest guess,
        # with WPA3 as a fallback in case the scan simply missed it.
        return ["wpa-psk"] if has_wpa2 else ["wpa-psk", "sae"]

    async def _wifi_device(self) -> str:
        output = await self._run("-t", "-f", "DEVICE,TYPE", "device", "status")
        for line in output.splitlines():
            parts = self._split_terse(line)
            if len(parts) >= 2 and parts[1] == "wifi":
                return parts[0]
        raise WifiUnavailableError("No WiFi adapter found — is the USB WiFi adapter plugged in?")

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
