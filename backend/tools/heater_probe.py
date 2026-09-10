#!/usr/bin/env python3
"""
Identify which BLE protocol this heater actually speaks.

STILL USEFUL for discovery - finding a MAC, telling MVP1 from MVP2.
It does NOT demonstrate a working connection: it uses a raw BleakClient,
and the agent (tools/heater_agent.py) is the reference for how to hold
a link to this heater. A companion script that polled with the
time-sync command was deleted rather than left as a misleading example.

Run on the Pi, in the van, with the Hcalory PHONE APP FULLY CLOSED and
the phone's Bluetooth OFF. These heaters accept exactly one connection,
so while the app holds it nothing else can see or reach the heater.

    python3 backend/tools/heater_probe.py                  # scan only
    python3 backend/tools/heater_probe.py AA:BB:CC:DD:EE:FF  # scan + connect

WHY THIS EXISTS
There are at least three families of Chinese diesel heater BLE protocol,
and two incompatible Hcalory variants:

    MVP1  service FFF0, write FFF2, notify FFF1
    MVP2  service BD39, write BDF7, notify BDF8
    AA55  service FFE0, characteristic FFE1   (Vevor/AirHeaterBLE)

They differ in characteristics AND in how the status frame is laid out,
so a plugin written for one reads garbage from another - or, more
likely, cannot find its characteristics at all and simply never
connects. The VanOS plugin was written against MVP1 before this was
known.

Guessing which one this van has would mean a trip to the van per guess.
This asks the heater instead.
"""

import asyncio
import sys

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    sys.exit("bleak is not installed. Run: pip install bleak")

# Service UUID -> what it implies. Lower case, as bleak reports them.
KNOWN_SERVICES = {
    "0000fff0-0000-1000-8000-00805f9b34fb": (
        "Hcalory MVP1 / ABBA / CBFF",
        "write 0000fff2, notify 0000fff1 - this is what the VanOS plugin expects",
    ),
    "0000bd39-0000-1000-8000-00805f9b34fb": (
        "Hcalory MVP2",
        "write 0000bdf7, notify 0000bdf8 - the VanOS plugin will NOT work as written",
    ),
    "0000ffe0-0000-1000-8000-00805f9b34fb": (
        "AA55 / AA66 (Vevor, AirHeaterBLE)",
        "single characteristic 0000ffe1 for read/write/notify",
    ),
}

NAME_HINTS = ("hcalory", "airheater", "heater", "ty")


async def scan() -> None:
    print("Scanning for 20 seconds. Phone app must be closed.\n")
    devices = await BleakScanner.discover(timeout=20.0, return_adv=True)

    interesting = []

    for address, (device, adv) in devices.items():
        name = (device.name or adv.local_name or "").strip()
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        hit = any(h in name.lower() for h in NAME_HINTS) if name else False
        hit = hit or any(u in KNOWN_SERVICES for u in uuids)

        line = f"  {address}  {adv.rssi:>4} dBm  {name or '(no name)'}"

        if hit:
            interesting.append((address, name, uuids))
            line += "   <-- LOOKS LIKE A HEATER"

        print(line)

        for uuid in uuids:
            if uuid in KNOWN_SERVICES:
                label, detail = KNOWN_SERVICES[uuid]
                print(f"        service {uuid[4:8].upper()}: {label}")
                print(f"        {detail}")

    print()

    if not interesting:
        # Said plainly, because "nothing found" has one overwhelmingly
        # likely cause and it is not a broken radio.
        print("No heater found. In order of likelihood:")
        print("  1. The phone app still has it. Force-close the app AND turn")
        print("     the phone's Bluetooth off - backgrounding is not enough.")
        print("  2. The heater is powered down at the panel.")
        print("  3. Out of range. BLE does not travel through a vehicle well;")
        print("     the Pi and the heater may need to be closer.")
        print()
        print("Sanity check: Victron devices advertise manufacturer ID 0x02e1.")
        print("If you can see those and not the heater, the radio is fine.")
        return

    print("Found. Now run again with the address to see what it exposes:")
    for address, name, _ in interesting:
        print(f"  python3 {sys.argv[0]} {address}")


async def probe(address: str) -> None:
    print(f"Connecting to {address}...\n")

    device = await BleakScanner.find_device_by_address(address, timeout=30.0)

    if device is None:
        sys.exit(f"{address} not found. Is the phone app holding it?")

    async with BleakClient(device, timeout=30.0) as client:
        print(f"Connected: {client.is_connected}\n")
        print("Services and characteristics:\n")

        verdict = None

        for service in client.services:
            uuid = service.uuid.lower()
            known = KNOWN_SERVICES.get(uuid)
            marker = f"   <-- {known[0]}" if known else ""
            print(f"  {service.uuid}{marker}")

            if known and verdict is None:
                verdict = known

            for char in service.characteristics:
                props = ",".join(char.properties)
                print(f"      {char.uuid}  [{props}]")

        print()

        if verdict:
            print(f"PROTOCOL: {verdict[0]}")
            print(f"          {verdict[1]}")
        else:
            # An unrecognised device is a finding, not a failure - it is
            # how a fourth protocol variant would first show up.
            print("PROTOCOL: not recognised.")
            print("          None of the known service UUIDs are present.")
            print("          Send this whole output on; it may be a variant")
            print("          nobody has documented yet.")


def main() -> None:
    if len(sys.argv) > 1:
        asyncio.run(probe(sys.argv[1]))
    else:
        asyncio.run(scan())


if __name__ == "__main__":
    main()
