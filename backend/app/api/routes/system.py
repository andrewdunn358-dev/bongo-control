"""
System API — operational actions on the backend process and the Pi
itself, not van hardware: restart the backend, restart Raspberry Pi
Connect, or reboot the Pi.

The Pi-level actions exist so a stalled remote-access tool never means
a drive to the van: as long as the dashboard loads over the Cloudflare
tunnel, Pi Connect can be kicked or the whole Pi rebooted from here.
They go over the host's system D-Bus, which the backend already has
mounted (/var/run/dbus) for Bluetooth and WiFi, and the container runs
as root, so systemd/logind accept the calls without extra privileges.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.routes.auth import require_app_token

logger = logging.getLogger("vanos.system")

# Gated the same as every other sensitive route in this app - a
# restart is genuinely disruptive (relays, voice control, telemetry
# all drop for the few seconds it takes to come back up), and the app
# is reachable from the whole internet once someone finds the
# Cloudflare hostname.
router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_app_token)])


async def _delayed_shutdown() -> None:
    """A brief delay so the HTTP response actually reaches the client
    before the process starts shutting down.

    Reported live: a relay that had genuinely been turned off came
    back ON after using this button - confirmed root cause: this
    originally called os._exit(0), a hard, immediate kill that skips
    Python entirely, including uvicorn's own signal handling and this
    app's own lifespan shutdown code. relay_service.stop() (which
    saves each relay's ACTUAL CURRENT commanded state as a "clean
    shutdown" record for the next startup to restore - see its own
    docstring) lives in that shutdown code, right after the lifespan's
    `yield`. Skipping it meant the next startup restored whatever
    STALE state was left over from the last genuinely clean shutdown
    (a real docker compose deploy, which always goes through this
    properly) - not what the relay actually was at the moment this
    button was pressed.

    Fixed by sending this process a real SIGTERM instead of killing it
    directly - the same signal Docker itself sends for an ordinary
    `docker compose down`/redeploy, which uvicorn is already built to
    catch and forward into a graceful shutdown, correctly running
    relay_service.stop() (and everything else after the lifespan's
    `yield`) before the process actually exits. Docker's own
    restart: unless-stopped policy on the backend service (confirmed
    in docker-compose.yml) still brings the container straight back up
    once uvicorn finishes exiting - nothing about that part changes.
    """
    await asyncio.sleep(0.5)
    logger.info(
        "System: restart requested via API - sending SIGTERM for a graceful shutdown "
        "(so relay_service.stop() and the rest of the normal shutdown sequence run correctly), "
        "then docker-compose's restart:unless-stopped policy brings the container back up"
    )
    os.kill(os.getpid(), signal.SIGTERM)


# The Pi user whose systemd user manager runs rpi-connect. Pi Connect
# is a USER service (systemctl --user), which the system bus can't
# restart on its own - restarting that user's manager (user@UID.service)
# restarts every user service with it, rpi-connect included. SSH
# sessions are separate scopes and survive it.
HOST_UID = int(os.environ.get("VANOS_HOST_UID", "1000"))


async def _system_bus_call(destination: str, path: str, interface: str, member: str, signature: str, body: list) -> None:
    from dbus_fast import BusType, Message, MessageType
    from dbus_fast.aio import MessageBus

    bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
    try:
        reply = await bus.call(
            Message(
                destination=destination,
                path=path,
                interface=interface,
                member=member,
                signature=signature,
                body=body,
            )
        )
        if reply.message_type == MessageType.ERROR:
            raise RuntimeError(f"{reply.error_name}: {reply.body[0] if reply.body else ''}")
    finally:
        bus.disconnect()


async def _delayed_reboot() -> None:
    # Long enough for the HTTP response to reach the browser first.
    await asyncio.sleep(2)
    logger.warning("System: Pi reboot requested via API")
    try:
        await _system_bus_call(
            "org.freedesktop.login1", "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager", "Reboot", "b", [False],
        )
    except Exception as e:  # noqa: BLE001 - logged; nothing else to do
        logger.error("System: reboot request failed: %s", e)


@router.post("/reboot-pi")
async def reboot_pi() -> dict:
    """Reboot the whole Pi. A clean reboot: Docker stops this container
    with SIGTERM first, so relay state is saved exactly as it is for
    'Reload backend'. Expect the dashboard to be gone for 1-3 minutes
    on a Pi 2B."""
    asyncio.create_task(_delayed_reboot())
    return {"rebooting": True}


@router.post("/restart-pi-connect")
async def restart_pi_connect() -> dict:
    """Restart Raspberry Pi Connect (and the rest of the Pi user's
    systemd user services) without rebooting. VanOS itself is unaffected."""
    unit = f"user@{HOST_UID}.service"
    try:
        await _system_bus_call(
            "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
            "org.freedesktop.systemd1.Manager", "RestartUnit", "ss", [unit, "replace"],
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not restart {unit}: {e}") from e
    logger.warning("System: restarted %s (Raspberry Pi Connect) via API", unit)
    return {"restarted": unit}


@router.post("/restart-backend")
async def restart_backend() -> dict:
    """Triggers a graceful shutdown of this process (see
    _delayed_shutdown()'s own docstring for why it must be graceful,
    not a hard kill). docker-compose.yml's backend service has
    restart: unless-stopped (confirmed by reading it directly) -
    Docker brings the container straight back up once this process
    exits, no separate action needed.

    This is a PROCESS restart only - it does NOT git pull, rebuild, or
    pick up new code. What it DOES pick up: config changes that need a
    fresh start to take effect (a new mic/speaker device, wake word,
    TTS provider, etc. - the always-on wake-word listener specifically
    only re-reads these at startup, not live). For deploying actual
    code changes, the real docker compose up -d --build command on the
    Pi is still what's needed - this button is for "I changed a
    setting and need the backend to notice", not "I pushed new code".
    """
    asyncio.create_task(_delayed_shutdown())
    return {"restarting": True}


def _lan_ipv4() -> str | None:
    """This Pi's address on the van's own network, or None.

    Asks the kernel which local address it would use to reach an outside
    host. A UDP connect() sends nothing - it only picks a route - so this
    works with no signal too: the router is still the default gateway
    whether or not it has a 4G connection. Docker bridges (172.17/18) are
    never the default route, so they are never picked.
    """
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # TEST-NET-1: never actually contacted
        ip = s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
    return None if ip.startswith("127.") else ip


def _own_ipv6_prefixes() -> set[str]:
    """The /64 networks this Pi has global IPv6 addresses in - i.e. the
    van's own network, as the router hands it out. Read from the kernel
    (the backend runs with host networking, so these are the Pi's)."""
    prefixes: set[str] = set()
    try:
        with open("/proc/net/if_inet6") as f:
            for line in f:
                parts = line.split()
                addr, scope = parts[0], parts[3]
                if scope == "00":  # global scope only
                    prefixes.add(addr[:16])  # first 64 bits, as hex
    except OSError:
        pass
    return prefixes


def _same_network(client_ip: str | None) -> bool:
    """Is this request from a device on the van's own network, arriving
    the long way round (out through the router, Cloudflare, the tunnel)?

    Decided ONLY from IPv6, where it is certain: every device on the
    van's network shares the router's /64. IPv4 is not used - behind the
    mobile carrier's shared NAT, strangers (or the same phone on its own
    mobile data) can share the van's public IPv4, and a wrong "yes" would
    send the phone to a local address it cannot reach.
    """
    import ipaddress

    if not client_ip:
        return False
    try:
        ip = ipaddress.ip_address(client_ip.strip())
    except ValueError:
        return False
    if ip.version != 6 or not ip.is_global:
        return False
    return ip.exploded.replace(":", "")[:16] in _own_ipv6_prefixes()


@router.get("/local-address")
async def local_address(request: Request) -> dict:
    """Where this van's app can be reached directly on the van's own
    network, and whether the caller is on that network right now.

    The app prefers the direct address (faster, needs no internet) and
    uses this to decide - see frontend lib/connection.ts.

    VANOS_LOCAL_URL overrides the detected address.
    """
    url = os.environ.get("VANOS_LOCAL_URL") or None
    if not url:
        ip = _lan_ipv4()
        port = os.environ.get("VANOS_LOCAL_PORT", "8090")
        url = f"http://{ip}:{port}" if ip else None
    # Cloudflare sets CF-Connecting-IP to the real client and overwrites
    # any value a client sends, so through the tunnel it can be trusted.
    # A request that did not come through the tunnel is already local.
    return {
        "url": url,
        "same_network": _same_network(request.headers.get("cf-connecting-ip")),
    }
