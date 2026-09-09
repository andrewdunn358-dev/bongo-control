#!/usr/bin/env python3
"""
Talk to an Hcalory MVP2 heater and print what it says.

    python3 tools/heater_mvp2_test.py 20:25:05:19:0D:33
    python3 tools/heater_mvp2_test.py 20:25:05:19:0D:33 1234   # different PIN

WHY THIS EXISTS
A raw bleak connect to this heater dies with "failed to discover
services, device disconnected". MVP2 requires a PASSWORD HANDSHAKE
before it will accept anything, and a client that connects and then
does nothing gets dropped. BLE pairing is not involved - attempting it
returns AuthenticationFailed, which matches the phone app never having
been paired either.

Protocol handled by `diesel-heater-ble` (MIT), which implements six
variants including MVP2. That package is protocol only: it builds and
parses packets and leaves the BLE transport to the caller. This is the
transport, kept deliberately small so it is obvious what is being sent.

Install first:
    docker compose exec backend pip install diesel-heater-ble
"""

import asyncio
import json
import sys

from bleak import BleakClient

MVP2_WRITE = "0000bdf7-0000-1000-8000-00805f9b34fb"
MVP2_NOTIFY = "0000bdf8-0000-1000-8000-00805f9b34fb"

# Long, because service discovery on a Pi 2B is not quick and this
# heater has already shown it will drop a slow client.
CONNECT_TIMEOUT = 45.0
REPLY_TIMEOUT = 15.0


async def main(address: str, pin: int) -> None:
    from diesel_heater_ble.protocol import ProtocolHcalory

    protocol = ProtocolHcalory()
    protocol.set_mvp_version(True)  # BD39 service = MVP2

    replies: asyncio.Queue = asyncio.Queue()

    async def on_notify(_char, data: bytearray) -> None:
        await replies.put(bytes(data))

    print(f"Connecting to {address} (PIN {pin:04d})...")

    # Connecting by address rather than scanning first: BlueZ discovery
    # running alongside a connect is a documented source of flakiness on
    # a Pi, and we already know this address.
    async with BleakClient(address, timeout=CONNECT_TIMEOUT) as client:
        print(f"Connected: {client.is_connected}\n")

        await client.start_notify(MVP2_NOTIFY, on_notify)

        # The handshake has to go first. Everything after it is ignored
        # until the heater has accepted a PIN.
        handshake = protocol.build_password_handshake(pin)
        print(f"-> handshake  {handshake.hex()}")
        await client.write_gatt_char(MVP2_WRITE, handshake, response=False)
        protocol.mark_password_sent()

        try:
            reply = await asyncio.wait_for(replies.get(), timeout=REPLY_TIMEOUT)
            print(f"<- {reply.hex()}\n")
        except asyncio.TimeoutError:
            # Not fatal. Some firmware acknowledges silently and only
            # answers the first real query.
            print("   (no reply to the handshake - continuing anyway)\n")

        # Now ask for status. Three times, because the first answer after
        # a handshake is sometimes a stub.
        for attempt in range(1, 4):
            # build_command(1, 0, pin) is the status query. On MVP2 it
            # routes to the 0A0A form, which carries a timestamp - so
            # each one differs from the last. That is expected.
            query = protocol.build_command(1, 0, pin)
            print(f"-> query #{attempt}  {bytes(query).hex()}")
            await client.write_gatt_char(MVP2_WRITE, query, response=False)

            try:
                reply = await asyncio.wait_for(replies.get(), timeout=REPLY_TIMEOUT)
            except asyncio.TimeoutError:
                print("   no reply\n")
                continue

            print(f"<- {reply.hex()}  ({len(reply)} bytes)")

            parsed = protocol.parse(bytearray(reply))

            if parsed:
                print(json.dumps(parsed, indent=4, default=str))
                print("\nWORKING. Those are real readings - compare them to the app.")
                return

            print("   (too short to parse - the heater may still be waking up)\n")
            await asyncio.sleep(2)

        print("Connected and wrote successfully, but got nothing parseable back.")
        print("If the PIN is wrong the heater accepts the write and stays silent,")
        print("so try 1234, or 0 if the manual says 0000.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <mac> [pin]")

    pin_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    asyncio.run(main(sys.argv[1], pin_arg))
