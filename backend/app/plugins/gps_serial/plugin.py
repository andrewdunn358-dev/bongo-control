"""
GPS serial plugin - reads NMEA sentences from a USB GPS receiver (a
VK-162 or similar) and feeds real fixes straight into location_service,
the same place a browser's geolocation call ends up.

WHY THIS EXISTS: the in-van tablet talks to the Pi over plain
http://<pi-ip>, and browsers refuse geolocation on an insecure origin -
a real, known limitation documented elsewhere in this project (see
bug-location-card-regression.md). A USB GPS receiver has no such
restriction: it just streams position data over a serial port,
independent of HTTPS, independent of any browser permission prompt,
independent of the phone/tablet having a location fix of its own at
all.

DEVICE PATH: same lesson as the webcam earlier tonight - don't trust a
bare /dev/ttyUSBn number, it can shift if the device is ever unplugged
and replugged into a different port. Use the udev-provided
/dev/serial/by-id/... path instead (stable, tied to the device's own
USB serial number, not enumeration order). Configured via the
GPS_DEVICE env var, same pattern as WEBCAM_DEVICE - see
docker-compose.yml's `devices:` section for this service, which is
what actually determines whether this path exists inside the
container at all.

NMEA PARSING: deliberately minimal, no new heavy dependency for this -
GPGGA (or GNGGA, common on GPS+GLONASS combo receivers like the VK-162)
is a simple, well-defined text sentence with an explicit fix-quality
field, which is all that's actually needed for the position itself.
Checksum-verified before trusting any coordinates from it, since a
truncated/corrupted serial read producing a garbage position would be
considerably worse than just not updating for one cycle.

Also parses GSV (Satellites in View) sentences for a genuine per-
satellite confidence view - elevation, azimuth, and signal-to-noise
ratio for every satellite the receiver can see, exactly the real data
behind a sky-plot. A receiver tracking more than 4 satellites needs
several GSV sentences in sequence to report them all (see msg_num/
total_msgs in parse_gsv) - handled by _update_satellites below, which
replaces one constellation's satellite set at the start of each new
round (msg_num == 1) and merges subsequent sentences into it, so the
displayed list is always the most recently completed information
rather than a partial one.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

from app.plugins.base import Plugin, PluginStatus

logger = logging.getLogger("vanos.plugins.gps_serial")

DEFAULT_DEVICE = "/dev/ttyUSB0"
DEFAULT_BAUD_RATE = 9600
READ_TIMEOUT_SECONDS = 2.0
# NMEA position updates are typically emitted once per second by
# consumer GPS receivers - nothing is gained by polling faster than
# that, and it just spins the read loop pointlessly if the device is
# quiet for a moment.
IDLE_SLEEP_SECONDS = 0.5

# Signal-to-noise ratio thresholds (dB-Hz) for the Strong/Good/Fair/Poor
# label shown per satellite - standard rough bands used by GPS receiver
# vendors generally (e.g. u-blox's own documentation), not invented for
# this project. Genuinely means something physical (signal strength),
# unlike a made-up single "92%" score with no defined basis.
SNR_STRONG_DBHZ = 40
SNR_GOOD_DBHZ = 30
SNR_FAIR_DBHZ = 20


def snr_quality(snr: int | None) -> str:
    if snr is None:
        return "not tracking"
    if snr >= SNR_STRONG_DBHZ:
        return "strong"
    if snr >= SNR_GOOD_DBHZ:
        return "good"
    if snr >= SNR_FAIR_DBHZ:
        return "fair"
    return "poor"


def _nmea_checksum_ok(sentence: str) -> bool:
    """NMEA sentences end '*XX' - XX is the hex XOR of every byte
    between '$' and '*'. A corrupted/truncated serial read producing a
    sentence that LOOKS parseable but has bad data is a real risk this
    guards against - reject rather than trust anything that fails.
    """
    if not sentence.startswith("$") or "*" not in sentence:
        return False
    body, _, checksum_hex = sentence[1:].partition("*")
    checksum_hex = checksum_hex.strip()
    if len(checksum_hex) < 2:
        return False
    try:
        expected = int(checksum_hex[:2], 16)
    except ValueError:
        return False
    actual = 0
    for ch in body:
        actual ^= ord(ch)
    return actual == expected


def _nmea_to_decimal(raw: str, hemisphere: str) -> float | None:
    """Converts NMEA's ddmm.mmmm / dddmm.mmmm format to plain decimal
    degrees. Latitude has a 2-digit degree part, longitude 3-digit -
    told apart by the position of the decimal point, not a fixed
    string length (leading zeros are sometimes dropped by different
    receivers)."""
    if not raw or "." not in raw:
        return None
    try:
        dot = raw.index(".")
        degrees = float(raw[: dot - 2])
        minutes = float(raw[dot - 2 :])
    except (ValueError, IndexError):
        return None
    decimal = degrees + minutes / 60.0
    if hemisphere in ("S", "W"):
        decimal = -decimal
    return decimal


def parse_gga(sentence: str) -> dict[str, Any] | None:
    """Parses a $GPGGA/$GNGGA sentence, returning
    {"latitude", "longitude", "satellites", "hdop"} if it represents a
    genuine fix, or None if it's the wrong sentence type, fails its
    checksum, or reports no fix (fix quality 0).

    Satellite count and HDOP (horizontal dilution of precision - lower
    is better, roughly the fix's own estimate of its horizontal
    uncertainty) are both already present in every GGA sentence - a
    free, honest confidence signal, not something that needs a second
    sentence type or any extra computation.
    """
    sentence = sentence.strip()
    if not (sentence.startswith("$GPGGA") or sentence.startswith("$GNGGA")):
        return None
    if not _nmea_checksum_ok(sentence):
        return None

    fields = sentence.split("*")[0].split(",")
    if len(fields) < 9:
        return None

    fix_quality = fields[6]
    if fix_quality in ("", "0"):
        return None  # 0 = no fix - the receiver is honest about not knowing yet

    lat = _nmea_to_decimal(fields[2], fields[3])
    lon = _nmea_to_decimal(fields[4], fields[5])
    if lat is None or lon is None:
        return None

    satellites: int | None
    try:
        satellites = int(fields[7]) if fields[7] else None
    except ValueError:
        satellites = None

    hdop: float | None
    try:
        hdop = float(fields[8]) if fields[8] else None
    except ValueError:
        hdop = None

    return {"latitude": lat, "longitude": lon, "satellites": satellites, "hdop": hdop}


_GSV_TALKER_RE = re.compile(r"^\$G([A-Z])GSV,")


def parse_gsv(sentence: str) -> dict[str, Any] | None:
    """Parses a single GSV (Satellites in View) sentence - one talker
    ID per GNSS constellation (GP=GPS, GL=GLONASS, GA=Galileo,
    GB=BeiDou - the VK-162 and similar u-blox receivers commonly emit
    both GPGSV and GLGSV). A receiver seeing more than 4 satellites
    needs several sequential sentences to report them all (max 4
    satellites per sentence) - this parses ONE sentence only; see
    GpsSerialPlugin._update_satellites for how a full multi-sentence
    round gets assembled.

    Returns None for a non-GSV sentence, a failed checksum, or
    malformed fields - never a partial/guessed result.
    """
    sentence = sentence.strip()
    match = _GSV_TALKER_RE.match(sentence)
    if not match:
        return None
    if not _nmea_checksum_ok(sentence):
        return None

    fields = sentence.split("*")[0].split(",")
    if len(fields) < 4:
        return None

    try:
        total_msgs = int(fields[1])
        msg_num = int(fields[2])
        total_in_view = int(fields[3])
    except ValueError:
        return None

    talker = match.group(1)  # e.g. "P" (GPS), "L" (GLONASS)
    satellites: list[dict[str, Any]] = []
    sat_fields = fields[4:]
    # Satellites come in fixed groups of 4 fields: PRN, elevation,
    # azimuth, SNR. The last sentence in a round is often padded with
    # an incomplete trailing group (fewer than 4 satellites left to
    # report) - stepping in 4s and requiring a non-empty PRN handles
    # that without special-casing it.
    for i in range(0, len(sat_fields) - 3, 4):
        prn_raw, elev_raw, az_raw, snr_raw = sat_fields[i : i + 4]
        if not prn_raw:
            continue
        try:
            prn = int(prn_raw)
        except ValueError:
            continue
        try:
            elevation = int(elev_raw) if elev_raw else None
        except ValueError:
            elevation = None
        try:
            azimuth = int(az_raw) if az_raw else None
        except ValueError:
            azimuth = None
        try:
            # Empty SNR is real, honest data, not a parse failure - it
            # means the receiver knows this satellite is up there (from
            # its almanac) but isn't actually receiving it well enough
            # to use right now.
            snr = int(snr_raw) if snr_raw else None
        except ValueError:
            snr = None
        satellites.append(
            {"prn": prn, "constellation": talker, "elevation": elevation, "azimuth": azimuth, "snr": snr}
        )

    return {"msg_num": msg_num, "total_msgs": total_msgs, "total_in_view": total_in_view, "satellites": satellites}


class GpsSerialPlugin(Plugin):
    name = "gps_serial"
    display_name = "GPS (USB serial)"
    version = "1.0.0"

    def __init__(self, bus) -> None:  # noqa: ANN001 - matches the base Plugin signature
        super().__init__(bus)
        self._task: asyncio.Task | None = None
        self._serial = None
        self._device = os.environ.get("GPS_DEVICE", DEFAULT_DEVICE)
        # Keyed by (constellation, prn) so GPS and GLONASS satellites
        # that happen to share a PRN number don't overwrite each other.
        self._satellites: dict[tuple[str, int], dict[str, Any]] = {}
        # Which constellations have a round currently in progress (seen
        # msg_num==1 but not yet msg_num==total_msgs) - lets a new round
        # starting mid-way through the previous one replace stale
        # entries cleanly instead of merging two different rounds
        # together.
        self._round_started: set[str] = set()

    async def start(self) -> None:
        self.status = PluginStatus.STARTING
        try:
            import serial
        except ImportError as e:
            self.status = PluginStatus.ERROR
            self.last_error = f"pyserial not installed: {e}"
            logger.error(self.last_error)
            return

        try:
            self._serial = await asyncio.to_thread(
                serial.Serial, self._device, DEFAULT_BAUD_RATE, timeout=READ_TIMEOUT_SECONDS
            )
        except Exception as e:  # noqa: BLE001 - device missing/busy/permission are all "not available", not fatal
            self.status = PluginStatus.ERROR
            self.last_error = (
                f"Couldn't open {self._device}: {e} - check GPS_DEVICE and the `devices:` "
                "mapping in docker-compose.yml, and confirm the path with "
                "`ls -la /dev/serial/by-id/` on the Pi"
            )
            logger.error(self.last_error)
            return

        self._task = asyncio.create_task(self._run())
        self.status = PluginStatus.RUNNING
        logger.info("GPS serial plugin started on %s", self._device)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._serial is not None:
            try:
                await asyncio.to_thread(self._serial.close)
            except Exception as e:  # noqa: BLE001 - best effort during shutdown
                logger.warning("Error closing GPS serial port: %s", e)
            self._serial = None
        self.status = PluginStatus.STOPPED

    async def _run(self) -> None:
        try:
            while True:
                line = await asyncio.to_thread(self._read_line)
                if line:
                    fix = parse_gga(line)
                    if fix is not None:
                        from app.services import location_service

                        location_service.set_from_gps(
                            fix["latitude"], fix["longitude"], satellites=fix["satellites"], hdop=fix["hdop"]
                        )
                        self.heartbeat()
                        continue

                    gsv = parse_gsv(line)
                    if gsv is not None:
                        self._update_satellites(gsv)
                else:
                    await asyncio.sleep(IDLE_SLEEP_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - keep the plugin alive, surface via status
            self.status = PluginStatus.ERROR
            self.record_error(str(e))
            logger.exception("GPS serial plugin failed")

    def _update_satellites(self, gsv: dict[str, Any]) -> None:
        """Assembles one constellation's satellite set across however
        many GSV sentences it takes to report them all. msg_num == 1
        starts a fresh round for that constellation (clearing anything
        left over from the previous round before adding this
        sentence's satellites); later sentences in the same round just
        add to it. This means the visible satellite list is always
        either "this round, so far" or "the last fully completed
        round" - never a mix of two different rounds.
        """
        constellations_in_this_sentence = {s["constellation"] for s in gsv["satellites"]}
        if gsv["msg_num"] == 1:
            for constellation in constellations_in_this_sentence:
                self._round_started.add(constellation)
                for key in [k for k in self._satellites if k[0] == constellation]:
                    del self._satellites[key]

        for sat in gsv["satellites"]:
            self._satellites[(sat["constellation"], sat["prn"])] = sat

        if gsv["msg_num"] >= gsv["total_msgs"]:
            self._round_started.difference_update(constellations_in_this_sentence)

    def get_satellites(self) -> list[dict[str, Any]]:
        """Every satellite currently known, actually-tracked ones
        (a real SNR reading) first and by strongest signal, then
        merely-visible ones (in the almanac, not currently locked)
        after. Used by the API for the satellite list / sky-plot -
        this is real, current data, not history.
        """
        sats = list(self._satellites.values())
        sats.sort(key=lambda s: (s["snr"] is None, -(s["snr"] or 0)))
        return sats

    def _read_line(self) -> str | None:
        """Blocking single-line read, run via asyncio.to_thread. The
        constructor's READ_TIMEOUT_SECONDS bounds how long this can
        block for, which is what keeps stop()'s task.cancel() actually
        responsive rather than stuck waiting on a port that's gone
        quiet."""
        if self._serial is None:
            return None
        raw = self._serial.readline()
        if not raw:
            return None
        try:
            return raw.decode("ascii", errors="ignore").strip()
        except Exception:  # noqa: BLE001 - a garbled line is just skipped, not fatal
            return None
