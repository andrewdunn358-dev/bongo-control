"""Bongo Control — MOCK BACKEND FOR EMERGENT SANDBOX ONLY.

⚠ This file MUST NOT be merged to the real repo. The real backend on the Pi
already implements this contract talking to actual hardware (Victron over
Bluetooth, DS18B20 1-Wire probes, GPIO relays, USB webcam via ffmpeg).

The mock exists so the sandbox preview can render the frontend end-to-end
against messages that match §2 of the rebuild spec exactly:

  - Per-domain WS messages (battery / solar / energy / environment /
    connectivity / system / weather) rather than a combined frame.
  - battery.soc_pct is ALWAYS null (no shunt) — this is what stops the app
    ever fabricating a state-of-charge figure.
  - EnergyPayload.loads is always {} (no circuit sensing).
  - EnvironmentPayload.humidity_pct is always null (DS18B20 is temp-only).
  - Sunrise/sunset are LOCAL strings without timezone.
  - source is set to "simulation" so the frontend's simulated-data banner
    is visible whenever this mock is in use.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

APP_PASSWORD = os.environ.get('APP_ACCESS_PASSWORD', 'bongo')
UNLOCK_TOKEN = os.environ.get('UNLOCK_TOKEN', 'bongo-mock-token-2026')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("bongo-mock")

app = FastAPI(title="Bongo Control (mock)")
api = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Auth (X-App-Token header, or ?token= query for <img> tags)
# ---------------------------------------------------------------------------
AUTH_REQUIRED = bool(APP_PASSWORD)

def _token_from(request: Request, query_token: Optional[str] = None) -> Optional[str]:
    t = request.headers.get("X-App-Token")
    if t:
        return t
    if query_token:
        return query_token
    return None

def _require_auth(request: Request, query_token: Optional[str] = None):
    if not AUTH_REQUIRED:
        return
    tok = _token_from(request, query_token)
    if tok != UNLOCK_TOKEN:
        raise HTTPException(status_code=401, detail="Unlock required")


# ---------------------------------------------------------------------------
# Simulation state
# ---------------------------------------------------------------------------
class Sim:
    def __init__(self) -> None:
        self.start = time.time()
        self.voltage = 12.85
        self.solar_w = 340.0
        self.load_w = 220.0
        self.peak_solar = 620.0
        self.yield_wh = 2600.0
        self.internal_c = 21.4
        self.external_c = 12.6
        # Relays — GPIO parallel with physical switches.
        self.relays = [
            {"id": "1", "label": "Interior LEDs", "commanded_on": True,  "last_changed": time.time() - 900},
            {"id": "2", "label": "Water pump",    "commanded_on": False, "last_changed": time.time() - 3600},
            {"id": "3", "label": "Fridge (aux)",  "commanded_on": True,  "last_changed": time.time() - 400},
            {"id": "4", "label": "Diesel heater", "commanded_on": False, "last_changed": time.time() - 7200},
        ]
        self.location = {"latitude": 45.5231, "longitude": -122.6765, "source": "manual"}
        # History (per-domain SQLite would be used in real impl — in-memory here).
        self.history: dict[str, list[tuple[float, Optional[float]]]] = {}

    def tick(self) -> None:
        hour = (datetime.now().hour + datetime.now().minute / 60.0)
        solar_factor = max(0.0, math.sin(((hour - 6) / 12.0) * math.pi))
        target = self.peak_solar * solar_factor + random.uniform(-25, 25)
        self.solar_w = max(0.0, self.solar_w * 0.85 + max(0.0, target) * 0.15)
        self.load_w = 180.0 + (60 if self.relays[3]["commanded_on"] else 0) + (40 if self.relays[2]["commanded_on"] else 0) + random.uniform(-30, 40)
        net = self.solar_w - self.load_w
        # Voltage drifts a hair toward a plausible band based on net flow
        target_v = 12.4 + (0.6 if net > 0 else -0.2) + math.sin(time.time() / 900) * 0.15
        self.voltage = self.voltage * 0.9 + target_v * 0.1
        self.internal_c = 21.0 + math.sin(hour / 24.0 * math.pi * 2) * 2.5 + random.uniform(-0.2, 0.2)
        self.external_c = 12.0 + math.sin((hour - 3) / 24.0 * math.pi * 2) * 7.5 + random.uniform(-0.3, 0.3)
        self.yield_wh += max(0.0, self.solar_w) / 3600.0
        # Record history samples (1 per tick)
        now = time.time()
        self._record("battery", now, round(self.voltage, 3))
        self._record("solar", now, round(self.solar_w, 1))
        self._record("energy", now, round(self.solar_w - self.load_w, 1))
        self._record("environment", now, round(self.internal_c, 2))

    def _record(self, domain: str, t: float, v: Optional[float]) -> None:
        buf = self.history.setdefault(domain, [])
        buf.append((t, v))
        # Keep ~30 days at 1/s (would be downsampled in real impl)
        max_len = 60 * 60 * 24 * 30
        if len(buf) > max_len:
            del buf[: len(buf) - max_len]

    # --------- Per-domain snapshots ---------
    def battery_payload(self) -> dict:
        # soc_pct is ALWAYS null — the whole project pivots on this.
        return {
            "soc_pct": None,
            "voltage": round(self.voltage, 3),
            "charging": self.solar_w > self.load_w,
            "charging_power_w": round(max(0.0, self.solar_w - self.load_w), 1),
        }

    def solar_payload(self) -> dict:
        state = "off" if self.solar_w < 5 else "bulk" if self.solar_w < self.peak_solar * 0.6 else "absorption"
        return {
            "watts": round(self.solar_w, 1),
            "peak_today_watts": round(self.peak_solar, 1),
            "yield_today_wh": round(self.yield_wh, 1),
            "charge_state": state,
            "charger_error": None,
            "load_current_a": None,
            "load_power_w": None,
        }

    def energy_payload(self) -> dict:
        return {
            "solar_watts": round(self.solar_w, 1),
            "load_watts": round(self.load_w, 1),
            "net_watts": round(self.solar_w - self.load_w, 1),
            # Empty on real hw — no circuit sensing.
            "loads": {},
        }

    def environment_payload(self) -> dict:
        return {
            "internal_temp_c": round(self.internal_c, 2),
            "external_temp_c": round(self.external_c, 2),
            "humidity_pct": None,  # DS18B20 is temperature-only
            "sensors": [
                {"id": "28-000004a1b2c3", "temperature_c": round(self.internal_c, 2), "role": "interior"},
                {"id": "28-000004a1b2d7", "temperature_c": round(self.external_c, 2), "role": "exterior"},
            ],
        }

    def connectivity_payload(self) -> dict:
        return {"online": True, "ssid": "Bongo-Hotspot", "ip": "10.42.0.1", "signal_dbm": -42}

    def system_payload(self) -> dict:
        return {
            "cpu_pct": round(20 + random.uniform(-5, 15), 1),
            "ram_pct": round(45 + random.uniform(-5, 5), 1),
            "temperature_c": round(52 + random.uniform(-3, 4), 1),
            "uptime_s": int(time.time() - self.start) + 86400,
            "version": "0.9.7-mock",
        }

    def weather_payload(self) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        rad_today = round(18 + random.uniform(-2, 3), 1)
        rad_tomorrow = round(rad_today * random.uniform(0.5, 1.15), 1)
        def _day(date: str, code: int, tmax: float, tmin: float, rad: float, sr: str, ss: str) -> dict:
            return {
                "date": date,
                "weather_code": code,
                "weather_description": _wmo(code),
                "temp_max_c": tmax,
                "temp_min_c": tmin,
                "shortwave_radiation_sum_mj": rad,
                "precipitation_probability_max_pct": random.randint(0, 60),
                "sunrise": f"{date}T05:{random.randint(35,55):02d}",  # local, no TZ
                "sunset":  f"{date}T20:{random.randint(30,55):02d}",
            }
        forecast = [_day((datetime.now() + timedelta(days=i)).strftime("%Y-%m-%d"),
                         random.choice([0, 1, 2, 3, 61, 45, 80]),
                         round(20 + random.uniform(-4, 6), 1),
                         round(11 + random.uniform(-2, 3), 1),
                         round(18 + random.uniform(-8, 6), 1),
                         "05:42", "20:34")
                    for i in range(5)]
        return {
            "current_temp_c": round(self.external_c, 1),
            "current_cloud_cover_pct": random.randint(10, 80),
            "current_weather_code": 2,
            "current_weather_description": "Partly cloudy",
            "today": _day(today, 2, forecast[0]["temp_max_c"], forecast[0]["temp_min_c"], rad_today, "05:42", "20:34"),
            "tomorrow": _day(tomorrow, forecast[1]["weather_code"], forecast[1]["temp_max_c"], forecast[1]["temp_min_c"], rad_tomorrow, "05:43", "20:33"),
            "forecast": forecast,
            "tomorrow_vs_today_radiation_ratio": round(rad_tomorrow / max(rad_today, 0.01), 2),
        }


def _wmo(code: int) -> str:
    if code == 0: return "Clear"
    if code in (1, 2): return "Partly cloudy"
    if code == 3: return "Overcast"
    if code in (45, 48): return "Fog"
    if 51 <= code <= 67: return "Rain"
    if 71 <= code <= 77: return "Snow"
    if 80 <= code <= 82: return "Showers"
    if code >= 95: return "Thunder"
    return "Unknown"


sim = Sim()


# ---------------------------------------------------------------------------
# WebSocket — one message per domain, tagged with source: "simulation"
# ---------------------------------------------------------------------------
DOMAIN_SOURCES = {
    "battery": "simulation",
    "solar": "simulation",
    "energy": "simulation",
    "environment": "simulation",
    "connectivity": "simulation",
    "system": "simulation",
    "weather": "simulation",
}
DOMAIN_BUILDERS = {
    "battery": lambda: sim.battery_payload(),
    "solar": lambda: sim.solar_payload(),
    "energy": lambda: sim.energy_payload(),
    "environment": lambda: sim.environment_payload(),
    "connectivity": lambda: sim.connectivity_payload(),
    "system": lambda: sim.system_payload(),
    "weather": lambda: sim.weather_payload(),
}


def _snapshot_msg(domain: str) -> dict:
    return {
        "domain": domain,
        "source": DOMAIN_SOURCES[domain],
        "timestamp": time.time(),
        "payload": DOMAIN_BUILDERS[domain](),
    }


async def _sim_loop() -> None:
    while True:
        sim.tick()
        await asyncio.sleep(1.0)


# Frontend uses import.meta.env.DEV to pick the WS path.
# In the Emergent sandbox that resolves to /api/ws/telemetry (ingress routes /api/*).
# In real prod nginx serves it at /ws/telemetry. We accept both here so the
# mock works either way.
async def _ws_handler(ws: WebSocket) -> None:
    await ws.accept()
    try:
        # Initial snapshot: all known domains
        for d in DOMAIN_BUILDERS.keys():
            await ws.send_json(_snapshot_msg(d))
        # Then push updates — rotate through domains, weather less often.
        tick = 0
        while True:
            await asyncio.sleep(1.0)
            tick += 1
            await ws.send_json(_snapshot_msg("battery"))
            await ws.send_json(_snapshot_msg("solar"))
            await ws.send_json(_snapshot_msg("energy"))
            if tick % 3 == 0:
                await ws.send_json(_snapshot_msg("environment"))
            if tick % 5 == 0:
                await ws.send_json(_snapshot_msg("connectivity"))
                await ws.send_json(_snapshot_msg("system"))
            if tick % 60 == 0:
                await ws.send_json(_snapshot_msg("weather"))
    except WebSocketDisconnect:
        return
    except Exception as e:  # noqa: BLE001
        logger.warning("ws error: %s", e)
        try: await ws.close()
        except Exception: pass


@app.websocket("/api/ws/telemetry")
async def ws_api(ws: WebSocket) -> None:
    await _ws_handler(ws)

@app.websocket("/ws/telemetry")
async def ws_prod(ws: WebSocket) -> None:
    await _ws_handler(ws)


# ---------------------------------------------------------------------------
# REST — matches §2.3 of the spec
# ---------------------------------------------------------------------------
@api.get("/health")
async def health() -> dict:
    return {"ok": True, "version": "0.9.7-mock", "plugins": [{"name": "simulation", "status": "healthy"}]}

@api.get("/battery")
async def rest_battery() -> dict: return sim.battery_payload()

@api.get("/solar")
async def rest_solar() -> dict: return sim.solar_payload()

@api.get("/energy")
async def rest_energy() -> dict: return sim.energy_payload()

@api.get("/environment")
async def rest_env() -> dict: return sim.environment_payload()

@api.get("/connectivity")
async def rest_conn() -> dict: return sim.connectivity_payload()

@api.get("/system")
async def rest_sys() -> dict: return sim.system_payload()


@api.get("/history/{domain}")
async def rest_history(domain: str, hours: float = 24.0) -> dict:
    buf = sim.history.get(domain, [])
    cutoff = time.time() - hours * 3600
    # Downsample to ~180 points max
    filtered = [(t, v) for (t, v) in buf if t >= cutoff]
    if len(filtered) > 180:
        step = max(1, len(filtered) // 180)
        filtered = filtered[::step]
    return {"domain": domain, "hours": hours, "series": [{"t": t, "value": v} for (t, v) in filtered]}


@api.get("/intelligence/mission-brief")
async def mission_brief() -> dict:
    v = sim.voltage
    status = "green" if v >= 12.6 else "amber" if v >= 12.2 else "red"
    summary_by_status = {
        "green": f"Bank at {v:.2f} V, solar at {int(sim.solar_w)} W — nothing to worry about.",
        "amber": f"Voltage {v:.2f} V — consider shedding non-essential loads after sunset.",
        "red": f"Voltage {v:.2f} V is low. Drive to charge, or turn everything non-essential off.",
    }
    recs_by_status = {
        "green": [
            "Safe to run inverter overnight.",
            "Solar tomorrow looks fine — no need to conserve.",
        ],
        "amber": [
            "Cut the heater after sunset if you can.",
            "Aim for a longer drive tomorrow to top up the alternator charge.",
        ],
        "red": [
            "Turn the inverter and heater off; keep fridge only.",
            "Drive to charge if you can. Voltage is genuinely low.",
        ],
    }
    return {
        "status": status,
        "summary": summary_by_status[status],
        "recommendations": recs_by_status[status],
        "predictions": [
            {"key": "solar_tomorrow_kwh", "label": "Solar tomorrow", "value": round(sim.yield_wh / 1000 * random.uniform(0.7, 1.2), 2), "unit": "kWh", "confidence": "low"},
        ],
        "signals": [
            {"source": "mppt", "severity": "info", "message": f"Solar at {int(sim.solar_w)} W", "weight": 0.4},
            {"source": "environment", "severity": "info", "message": f"Interior {sim.internal_c:.1f}°C", "weight": 0.2},
        ],
        "computed_at": time.time(),
    }


# --- POI ---
_POI_SEED = [
    {"id": "poi-1", "name": "Ridgeline Spring", "category": "water", "lat_off": 0.008, "lng_off": -0.010, "note": "Cold potable spring"},
    {"id": "poi-2", "name": "Cedar Grove Dump", "category": "dump", "lat_off": -0.014, "lng_off": 0.019, "note": "Free grey + black dump"},
    {"id": "poi-3", "name": "Aurora Diner", "category": "food", "lat_off": 0.006, "lng_off": 0.012, "note": "24h diner, great breakfast"},
    {"id": "poi-4", "name": "Shell Fuel Stop", "category": "fuel", "lat_off": -0.005, "lng_off": -0.007, "note": "Diesel available"},
    {"id": "poi-5", "name": "Pinehollow Camp", "category": "camping", "lat_off": 0.021, "lng_off": 0.006, "note": "Free dispersed camping"},
    {"id": "poi-6", "name": "Blue Ridge Overlook", "category": "camping", "lat_off": -0.019, "lng_off": -0.015, "note": "Scenic overnight allowed"},
    {"id": "poi-7", "name": "Riverfront Laundry", "category": "food", "lat_off": 0.011, "lng_off": -0.018, "note": "Laundromat + coffee"},
    {"id": "poi-8", "name": "Northgate Water Fill", "category": "water", "lat_off": -0.011, "lng_off": 0.016, "note": "$1 potable fill"},
]

def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@api.get("/poi/nearby")
async def poi_nearby(radius_m: float = 5000.0, categories: Optional[str] = None) -> dict:
    lat = sim.location["latitude"]
    lng = sim.location["longitude"]
    cats = set([c.strip() for c in categories.split(",")]) if categories else None
    items = []
    for p in _POI_SEED:
        if cats and p["category"] not in cats:
            continue
        plat = lat + p["lat_off"]
        plng = lng + p["lng_off"]
        dist = _haversine_m(lat, lng, plat, plng)
        if dist > radius_m:
            continue
        items.append({
            "id": p["id"], "name": p["name"], "category": p["category"],
            "lat": round(plat, 6), "lng": round(plng, 6),
            "distance_m": round(dist, 1),
            "note": p["note"],
            "cached_at": datetime.now(timezone.utc).isoformat(),
        })
    items.sort(key=lambda x: x["distance_m"])
    return {"items": items, "cached": False, "cached_at": None, "center": {"lat": lat, "lng": lng}}


@api.get("/ai/status")
async def ai_status() -> dict:
    return {"configured": False}  # No real AI key in the mock


@api.get("/ai/nearby-recommendations")
async def ai_nearby(request: Request) -> dict:
    _require_auth(request)
    raise HTTPException(status_code=503, detail="AI provider not configured in mock backend")


@api.get("/location")
async def get_location() -> dict:
    return sim.location


class GpsBody(BaseModel):
    latitude: float
    longitude: float

@api.post("/location/gps")
async def set_gps(body: GpsBody) -> dict:
    sim.location["latitude"] = body.latitude
    sim.location["longitude"] = body.longitude
    sim.location["source"] = "gps"
    return {"ok": True}

@api.post("/location/ip-fallback")
async def ip_fallback() -> dict:
    sim.location["source"] = "ip"
    return {"ok": True}


# --- Relays ---
@api.get("/relays")
async def relays(request: Request) -> dict:
    _require_auth(request)
    return {"relays": sim.relays}

class RelaySet(BaseModel):
    on: bool

@api.post("/relays/{rid}/set")
async def relay_set(rid: str, body: RelaySet, request: Request) -> dict:
    _require_auth(request)
    match = next((r for r in sim.relays if r["id"] == rid), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Relay {rid} not found")
    match["commanded_on"] = bool(body.on)
    match["last_changed"] = time.time()
    return match

@api.post("/relays/{rid}/toggle")
async def relay_toggle(rid: str, request: Request) -> dict:
    _require_auth(request)
    match = next((r for r in sim.relays if r["id"] == rid), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Relay {rid} not found")
    match["commanded_on"] = not match["commanded_on"]
    match["last_changed"] = time.time()
    return match

@api.post("/relays/all-off")
async def relay_all_off(request: Request) -> dict:
    _require_auth(request)
    for r in sim.relays:
        if r["commanded_on"]:
            r["commanded_on"] = False
            r["last_changed"] = time.time()
    return {"ok": True}


# --- Camera ---
@api.get("/camera/snapshot")
async def camera_snapshot(request: Request, token: Optional[str] = Query(None)) -> Response:
    _require_auth(request, token)
    ts = datetime.now().strftime("%H:%M:%S")
    svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720' viewBox='0 0 1280 720'>
      <defs>
        <linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
          <stop offset='0%' stop-color='#0a1628'/><stop offset='55%' stop-color='#0f2942'/><stop offset='100%' stop-color='#1a3d66'/>
        </linearGradient>
        <radialGradient id='p' cx='35%' cy='40%' r='60%'><stop offset='0%' stop-color='#22d3ee' stop-opacity='0.5'/><stop offset='60%' stop-color='#22d3ee' stop-opacity='0'/></radialGradient>
      </defs>
      <rect width='1280' height='720' fill='url(#g)'/><rect width='1280' height='720' fill='url(#p)'/>
      <g font-family='JetBrains Mono, monospace' fill='#e6f0ff'>
        <text x='40' y='60' font-size='28' opacity='0.85'>BONGO-WEBCAM (mock)</text>
        <text x='40' y='680' font-size='22' opacity='0.75'>{ts} · 1280×720 · simulation</text>
      </g>
      <circle cx='1220' cy='55' r='10' fill='#ef4444'><animate attributeName='opacity' values='1;0.3;1' dur='1.2s' repeatCount='indefinite'/></circle>
      <text x='1160' y='62' font-family='Space Grotesk' fill='#e6f0ff' font-size='22'>LIVE</text>
    </svg>""".strip()
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@api.get("/camera/stream")
async def camera_stream(request: Request, token: Optional[str] = Query(None)) -> Response:
    _require_auth(request, token)
    return Response(status_code=501, content="MJPEG stream disabled in mock — use /camera/snapshot polling")


# --- Auth ---
class UnlockBody(BaseModel):
    password: str

@api.get("/auth/status")
async def auth_status() -> dict:
    return {"required": AUTH_REQUIRED}

@api.post("/auth/unlock")
async def auth_unlock(body: UnlockBody) -> dict:
    if not AUTH_REQUIRED:
        return {"token": ""}
    if body.password == APP_PASSWORD:
        return {"token": UNLOCK_TOKEN, "expires_in": 3600}
    raise HTTPException(status_code=401, detail="Invalid password")


# --- WiFi ---
_WIFI_NETS = [
    {"ssid": "Bongo-Hotspot",     "signal": -42, "secured": True,  "current": True},
    {"ssid": "CampWiFi_Free",     "signal": -58, "secured": False, "current": False},
    {"ssid": "Starlink_Cabin",    "signal": -63, "secured": True,  "current": False},
    {"ssid": "Aurora-Diner-Guest","signal": -71, "secured": True,  "current": False},
    {"ssid": "TMobile-5G",        "signal": -78, "secured": True,  "current": False},
]
_WIFI_STATE = {"connected": True, "ssid": "Bongo-Hotspot", "ip": "10.42.0.1"}

@api.get("/wifi/status")
async def wifi_status() -> dict:
    return _WIFI_STATE

@api.get("/wifi/scan")
async def wifi_scan() -> dict:
    nets = [n | {"signal": n["signal"] + random.randint(-3, 3)} for n in _WIFI_NETS]
    return {"networks": nets}

class WifiConnect(BaseModel):
    ssid: str
    password: Optional[str] = None

@api.post("/wifi/connect")
async def wifi_connect(body: WifiConnect) -> dict:
    match = next((n for n in _WIFI_NETS if n["ssid"] == body.ssid), None)
    if not match:
        raise HTTPException(status_code=404, detail="Network not in scan cache")
    if match["secured"] and not body.password:
        raise HTTPException(status_code=400, detail="Password required")
    _WIFI_STATE["connected"] = True
    _WIFI_STATE["ssid"] = body.ssid
    _WIFI_STATE["ip"] = f"10.42.0.{random.randint(2, 254)}"
    for n in _WIFI_NETS:
        n["current"] = n["ssid"] == body.ssid
    return {"ok": True, "connected_to": body.ssid, "ip": _WIFI_STATE["ip"]}


# --- Plugins / settings ---
_PLUGINS = [
    {"name": "victron-mppt-bt", "version": "1.4.2", "status": "healthy", "last_seen": "just now", "enabled": True},
    {"name": "onewire-temp",    "version": "0.9.7", "status": "healthy", "last_seen": "just now", "enabled": True},
    {"name": "gpio-relays",     "version": "2.1.0", "status": "healthy", "last_seen": "2s ago",   "enabled": True},
    {"name": "camera-webcam",   "version": "0.3.1", "status": "healthy", "last_seen": "just now", "enabled": True},
    {"name": "wifi-manager",    "version": "1.0.5", "status": "healthy", "last_seen": "just now", "enabled": True},
    {"name": "poi-cache",       "version": "0.5.0", "status": "healthy", "last_seen": "cached",   "enabled": True},
    {"name": "simulation",      "version": "0.9.0", "status": "degraded","last_seen": "just now", "enabled": True},
]

@api.get("/plugins")
async def plugins() -> dict:
    return {"plugins": _PLUGINS}

@api.get("/settings")
async def settings() -> dict:
    return {"theme": "dark", "nearby_radius_m": 5000}


# ---------------------------------------------------------------------------
# Wire-up
# ---------------------------------------------------------------------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def _startup() -> None:
    asyncio.create_task(_sim_loop())
    logger.info("bongo mock backend ready (auth_required=%s)", AUTH_REQUIRED)
