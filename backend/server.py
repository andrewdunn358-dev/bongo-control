"""Bongo Control - FastAPI backend

Provides simulated telemetry via WebSocket, mission brief intelligence, POIs,
weather passthrough (Open-Meteo), history graphs, camera snapshot, wifi and
plugin status endpoints. Everything is best-effort simulated so the frontend
UI is fully functional end-to-end.

All routes are prefixed with /api (including the telemetry WebSocket at
/api/ws/telemetry) so the Kubernetes ingress routes them to port 8001.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import math
import os
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
CORS_ORIGINS = os.environ.get('CORS_ORIGINS', '*').split(',')
UNLOCK_PASSWORD = os.environ.get('UNLOCK_PASSWORD', 'bongo')
UNLOCK_TOKEN = os.environ.get('UNLOCK_TOKEN', 'bongo-unlock-token-2026')

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

app = FastAPI(title="Bongo Control API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("bongo")


# ---------------------------------------------------------------------------
# Simulation state
# ---------------------------------------------------------------------------
class SimState:
    """Deterministic-ish sim so multiple clients see similar data."""

    def __init__(self) -> None:
        self.start = time.time()
        self.battery_soc = 74.0          # %
        self.battery_voltage = 12.8      # V
        self.battery_current = -8.4      # A (negative = discharging)
        self.solar_power = 340.0         # W
        self.solar_voltage = 18.2
        self.solar_current = 18.7
        self.load_power = 220.0          # W
        self.inverter_on = True
        self.heater_on = False
        self.fridge_on = True
        self.interior_temp = 21.4
        self.exterior_temp = 14.8
        self.water_tank = 62.0           # %

    def tick(self) -> None:
        # Time of day (0..24) — simulate solar bell curve
        t = (time.time() - self.start) / 60.0  # minutes elapsed
        hour = ((datetime.now().hour + datetime.now().minute / 60.0) + t / 30.0) % 24
        # Solar bell curve peaks around 13:00
        solar_factor = max(0.0, math.sin(((hour - 6) / 12.0) * math.pi))
        target_solar = 620.0 * solar_factor + random.uniform(-25, 25)
        target_solar = max(0.0, target_solar)
        self.solar_power = round(self.solar_power * 0.85 + target_solar * 0.15, 1)
        self.solar_voltage = round(17.5 + random.uniform(-0.4, 0.9), 2)
        self.solar_current = round(self.solar_power / max(self.solar_voltage, 0.1), 2)

        # Load — jittered
        base_load = 180.0 + (60.0 if self.heater_on else 0.0) + (40.0 if self.fridge_on else 0.0)
        self.load_power = round(base_load + random.uniform(-30, 60), 1)

        # Net current -> SoC delta
        net_watts = self.solar_power - self.load_power
        # Very small SoC drift per tick (~1s)
        self.battery_soc = max(4.0, min(100.0, self.battery_soc + (net_watts / 3600.0) * 0.02))
        self.battery_voltage = round(12.3 + (self.battery_soc / 100.0) * 1.1 + random.uniform(-0.05, 0.05), 2)
        self.battery_current = round((net_watts) / max(self.battery_voltage, 0.1), 2)

        self.interior_temp = round(21.0 + math.sin(hour / 24.0 * math.pi * 2) * 2.5 + random.uniform(-0.2, 0.2), 1)
        self.exterior_temp = round(12.0 + math.sin((hour - 3) / 24.0 * math.pi * 2) * 8.0 + random.uniform(-0.3, 0.3), 1)
        self.water_tank = max(5.0, self.water_tank - 0.001)

    def snapshot(self) -> dict:
        return {
            "ts": datetime.now(timezone.utc).isoformat(),
            "battery": {
                "soc": round(self.battery_soc, 1),
                "voltage": self.battery_voltage,
                "current": self.battery_current,
                "power": round(self.battery_voltage * self.battery_current, 1),
                "status": "charging" if self.battery_current > 0 else "discharging",
            },
            "solar": {
                "power": self.solar_power,
                "voltage": self.solar_voltage,
                "current": self.solar_current,
                "today_kwh": round(2.4 + math.sin(time.time() / 100) * 0.4, 2),
            },
            "load": {
                "power": self.load_power,
                "inverter_on": self.inverter_on,
                "heater_on": self.heater_on,
                "fridge_on": self.fridge_on,
            },
            "climate": {
                "interior_c": self.interior_temp,
                "exterior_c": self.exterior_temp,
            },
            "tanks": {
                "water_pct": round(self.water_tank, 1),
            },
        }


sim = SimState()


async def _sim_loop() -> None:
    while True:
        sim.tick()
        await asyncio.sleep(1.0)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class UnlockRequest(BaseModel):
    password: str


class WifiConnectRequest(BaseModel):
    ssid: str
    password: Optional[str] = None


class SettingsUpdate(BaseModel):
    theme: Optional[str] = None
    password_gate: Optional[bool] = None


# ---------------------------------------------------------------------------
# Basic routes
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root() -> dict:
    return {"service": "bongo-control", "status": "ok"}


@api_router.get("/health")
async def health() -> dict:
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


@api_router.get("/telemetry/snapshot")
async def telemetry_snapshot() -> dict:
    return sim.snapshot()


# ---------------------------------------------------------------------------
# WebSocket telemetry (prefixed with /api so ingress routes it)
# ---------------------------------------------------------------------------
@app.websocket("/api/ws/telemetry")
async def ws_telemetry(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(sim.snapshot())
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return
    except Exception as e:  # noqa: BLE001
        logger.warning("ws_telemetry error: %s", e)
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Intelligence (mission brief / SITREP)
# ---------------------------------------------------------------------------
def _mission_status(snap: dict) -> str:
    soc = snap["battery"]["soc"]
    if soc >= 55:
        return "green"
    if soc >= 25:
        return "amber"
    return "red"


@api_router.get("/intelligence/mission-brief")
async def mission_brief() -> dict:
    snap = sim.snapshot()
    status = _mission_status(snap)
    # Rough runtime estimate: usable Wh at 12V nominal, 200Ah bank
    usable_wh = (snap["battery"]["soc"] - 15.0) / 100.0 * (200.0 * 12.6)
    load_w = max(50.0, snap["load"]["power"])
    runtime_h = max(0.0, usable_wh / load_w)
    heater_hours = max(0.0, usable_wh / 900.0)  # heater ~ 900W
    solar_forecast_kwh = round(2.4 + random.uniform(-0.4, 0.6), 2)

    recs_by_status = {
        "green": [
            "All systems nominal — safe to run inverter overnight.",
            f"Estimated {runtime_h:.1f}h runtime at current draw.",
            "Solar looks good tomorrow — no need to conserve.",
        ],
        "amber": [
            "Battery at moderate levels — avoid heavy loads after sunset.",
            f"Estimated {runtime_h:.1f}h runtime — heater safe for {heater_hours:.1f}h.",
            "Consider driving to charge alternator if overcast tomorrow.",
        ],
        "red": [
            "Battery is low — shed non-essential loads immediately.",
            "Turn off inverter and heater; keep fridge only.",
            f"Only {runtime_h:.1f}h of essential-load runtime remaining.",
        ],
    }
    return {
        "status": status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "runtime_hours": round(runtime_h, 1),
        "heater_hours": round(heater_hours, 1),
        "solar_forecast_kwh": solar_forecast_kwh,
        "recommendations": recs_by_status[status],
        "highlights": {
            "battery_soc": snap["battery"]["soc"],
            "solar_now_w": snap["solar"]["power"],
            "load_now_w": snap["load"]["power"],
            "interior_c": snap["climate"]["interior_c"],
        },
    }


# ---------------------------------------------------------------------------
# POI + AI nearby recommendations
# ---------------------------------------------------------------------------
_POI_SEED = [
    {"id": "poi-1", "name": "Ridgeline Spring", "type": "water", "lat_off": 0.008, "lng_off": -0.010, "note": "Cold potable spring, 24/7 access"},
    {"id": "poi-2", "name": "Cedar Grove Dump", "type": "dump", "lat_off": -0.014, "lng_off": 0.019, "note": "Free grey + black water dump"},
    {"id": "poi-3", "name": "Aurora Diner", "type": "food", "lat_off": 0.006, "lng_off": 0.012, "note": "24h diner, great breakfast"},
    {"id": "poi-4", "name": "Shell Fuel Stop", "type": "fuel", "lat_off": -0.005, "lng_off": -0.007, "note": "Diesel available"},
    {"id": "poi-5", "name": "Pinehollow Camp", "type": "camping", "lat_off": 0.021, "lng_off": 0.006, "note": "Free dispersed camping, flat pads"},
    {"id": "poi-6", "name": "Blue Ridge Overlook", "type": "camping", "lat_off": -0.019, "lng_off": -0.015, "note": "Scenic overnight allowed"},
    {"id": "poi-7", "name": "Riverfront Laundry", "type": "food", "lat_off": 0.011, "lng_off": -0.018, "note": "Laundromat + coffee bar"},
    {"id": "poi-8", "name": "Northgate Water Fill", "type": "water", "lat_off": -0.011, "lng_off": 0.016, "note": "$1 potable fill station"},
]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@api_router.get("/poi/nearby")
async def poi_nearby(
    lat: float = Query(45.5231),
    lng: float = Query(-122.6765),
    limit: int = 20,
) -> dict:
    items = []
    for p in _POI_SEED[:limit]:
        plat = lat + p["lat_off"]
        plng = lng + p["lng_off"]
        items.append({
            "id": p["id"],
            "name": p["name"],
            "type": p["type"],
            "lat": round(plat, 6),
            "lng": round(plng, 6),
            "distance_km": round(_haversine_km(lat, lng, plat, plng), 2),
            "note": p["note"],
            "offline_cached": True,
        })
    items.sort(key=lambda x: x["distance_km"])
    return {"center": {"lat": lat, "lng": lng}, "items": items, "cached_at": datetime.now(timezone.utc).isoformat()}


@api_router.get("/ai/nearby-recommendations")
async def ai_nearby_recommendations(
    lat: float = Query(45.5231),
    lng: float = Query(-122.6765),
) -> dict:
    data = await poi_nearby(lat=lat, lng=lng, limit=20)
    items = data["items"]
    # Pick top 3 by heuristic: prefer water + dump combo, then closest camping
    water = next((p for p in items if p["type"] == "water"), None)
    dump = next((p for p in items if p["type"] == "dump"), None)
    camp = next((p for p in items if p["type"] == "camping"), None)
    picks = []
    if water:
        picks.append({"poi": water, "reason": "Closest potable water — top up before nightfall."})
    if dump:
        picks.append({"poi": dump, "reason": "Free dump station — pair with the water fill nearby."})
    if camp:
        picks.append({"poi": camp, "reason": "Best overnight camp match: flat, quiet, dark-sky friendly."})
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": "Overnight plan: water → dump → camp. All within 3 km, offline-cached and rated by other van-lifers.",
        "picks": picks,
    }


# ---------------------------------------------------------------------------
# Weather (Open-Meteo passthrough) + solar outlook
# ---------------------------------------------------------------------------
@api_router.get("/weather/forecast")
async def weather_forecast(
    lat: float = Query(45.5231),
    lng: float = Query(-122.6765),
) -> dict:
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m",
        "hourly": "shortwave_radiation",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum,sunrise,sunset,wind_speed_10m_max",
        "timezone": "auto",
        "forecast_days": 7,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:  # noqa: BLE001
        logger.warning("open-meteo failed, using stub: %s", e)
        data = _stub_weather()

    # Compose a solar outlook (today vs tomorrow hourly bars)
    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    rad = hourly.get("shortwave_radiation", [])
    today_str = datetime.now().strftime("%Y-%m-%d")
    tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    def _bucketed(day_prefix: str) -> list[dict]:
        out = []
        for t, v in zip(times, rad):
            if t.startswith(day_prefix):
                hour = int(t[11:13])
                out.append({"hour": hour, "wm2": v or 0})
        return out

    solar_outlook = {
        "today": _bucketed(today_str),
        "tomorrow": _bucketed(tomorrow_str),
    }
    data["solar_outlook"] = solar_outlook
    return data


def _stub_weather() -> dict:
    now = datetime.now()
    times = [(now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=i)).isoformat() for i in range(-6, 48)]
    rad = [max(0, 800 * math.sin(((int(t[11:13]) - 6) / 12) * math.pi)) for t in times]
    daily_dates = [(now + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    return {
        "current": {
            "temperature_2m": 16.4, "relative_humidity_2m": 62,
            "apparent_temperature": 15.9, "precipitation": 0.0,
            "weather_code": 2, "cloud_cover": 40, "wind_speed_10m": 12.4,
        },
        "hourly": {"time": times, "shortwave_radiation": rad},
        "daily": {
            "time": daily_dates,
            "weather_code": [2, 3, 61, 2, 1, 0, 45],
            "temperature_2m_max": [22, 21, 18, 20, 24, 26, 23],
            "temperature_2m_min": [11, 12, 13, 10, 11, 13, 12],
            "precipitation_sum": [0, 0.4, 6.8, 0, 0, 0, 0.2],
            "shortwave_radiation_sum": [22.4, 18.6, 9.2, 21.1, 24.8, 26.0, 17.4],
            "sunrise": [f"{d}T06:12" for d in daily_dates],
            "sunset": [f"{d}T20:34" for d in daily_dates],
            "wind_speed_10m_max": [14, 18, 26, 11, 9, 12, 20],
        },
    }


# ---------------------------------------------------------------------------
# History graphs
# ---------------------------------------------------------------------------
def _series_for(domain: str, points: int, hours_span: float) -> list[dict]:
    now = datetime.now(timezone.utc)
    out = []
    for i in range(points):
        t = now - timedelta(hours=hours_span * (points - 1 - i) / max(points - 1, 1))
        frac = i / max(points - 1, 1)
        if domain == "battery":
            v = 55 + 30 * math.sin(frac * math.pi * 2 + 0.4) + random.uniform(-2, 2)
            out.append({"t": t.isoformat(), "value": round(max(4, min(100, v)), 1)})
        elif domain == "solar":
            v = 620 * max(0, math.sin(frac * math.pi))
            v += random.uniform(-40, 40)
            out.append({"t": t.isoformat(), "value": round(max(0, v), 1)})
        elif domain == "load":
            v = 220 + 80 * math.sin(frac * math.pi * 3) + random.uniform(-40, 40)
            out.append({"t": t.isoformat(), "value": round(max(40, v), 1)})
        elif domain == "temp":
            v = 18 + 6 * math.sin(frac * math.pi * 2) + random.uniform(-0.5, 0.5)
            out.append({"t": t.isoformat(), "value": round(v, 1)})
        else:
            out.append({"t": t.isoformat(), "value": round(random.uniform(0, 100), 1)})
    return out


@api_router.get("/history/{domain}")
async def history(domain: str, range: str = Query("24h")) -> dict:
    valid = {"battery", "solar", "load", "temp"}
    if domain not in valid:
        raise HTTPException(status_code=404, detail=f"Unknown domain '{domain}'")
    range_map = {
        "1h": (60, 1.0),
        "24h": (96, 24.0),
        "7d": (168, 24 * 7),
        "30d": (180, 24 * 30),
    }
    if range not in range_map:
        raise HTTPException(status_code=400, detail="range must be one of 1h,24h,7d,30d")
    points, hours = range_map[range]
    return {"domain": domain, "range": range, "series": _series_for(domain, points, hours)}


# ---------------------------------------------------------------------------
# Camera snapshot (returns a synthesized JPEG-ish PNG) + auth gate
# ---------------------------------------------------------------------------
_PLACEHOLDER_PNG = base64.b64decode(
    # 1x1 transparent PNG
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


@api_router.post("/auth/unlock")
async def auth_unlock(req: UnlockRequest) -> dict:
    if req.password == UNLOCK_PASSWORD:
        return {"token": UNLOCK_TOKEN, "expires_in": 3600}
    raise HTTPException(status_code=401, detail="Invalid password")


def _valid_token(token: Optional[str]) -> bool:
    if not token:
        return False
    if token.startswith("Bearer "):
        token = token[7:]
    return token == UNLOCK_TOKEN


@api_router.get("/camera/snapshot")
async def camera_snapshot(token: Optional[str] = Query(None)) -> Response:
    if not _valid_token(token):
        raise HTTPException(status_code=401, detail="Camera locked — unlock first")
    # Return a synthetic SVG frame with a timestamp so it visibly refreshes.
    ts = datetime.now().strftime("%H:%M:%S")
    svg = f"""
    <svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720' viewBox='0 0 1280 720'>
      <defs>
        <linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
          <stop offset='0%' stop-color='#0a1628'/>
          <stop offset='55%' stop-color='#0f2942'/>
          <stop offset='100%' stop-color='#1a3d66'/>
        </linearGradient>
        <radialGradient id='p' cx='30%' cy='40%' r='60%'>
          <stop offset='0%' stop-color='#22d3ee' stop-opacity='0.55'/>
          <stop offset='60%' stop-color='#22d3ee' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='p2' cx='75%' cy='70%' r='60%'>
          <stop offset='0%' stop-color='#a855f7' stop-opacity='0.45'/>
          <stop offset='60%' stop-color='#a855f7' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1280' height='720' fill='url(#g)'/>
      <rect width='1280' height='720' fill='url(#p)'/>
      <rect width='1280' height='720' fill='url(#p2)'/>
      <g font-family='JetBrains Mono, monospace' fill='#e6f0ff'>
        <text x='40' y='60' font-size='28' opacity='0.85'>BONGO-CAM-01 · REAR</text>
        <text x='40' y='680' font-size='22' opacity='0.75'>{ts}  ·  1280×720  ·  simulated stream</text>
      </g>
      <circle cx='1220' cy='55' r='10' fill='#ef4444'>
        <animate attributeName='opacity' values='1;0.3;1' dur='1.2s' repeatCount='indefinite'/>
      </circle>
      <text x='1160' y='62' font-family='Space Grotesk, sans-serif' fill='#e6f0ff' font-size='22'>LIVE</text>
    </svg>
    """.strip()
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# WiFi
# ---------------------------------------------------------------------------
_WIFI_STATE = {"connected": True, "ssid": "Bongo-Hotspot", "ip": "10.42.0.1"}
_WIFI_NETWORKS = [
    {"ssid": "Bongo-Hotspot", "signal": -42, "secured": True, "current": True},
    {"ssid": "CampWiFi_Free", "signal": -58, "secured": False, "current": False},
    {"ssid": "Starlink_Cabin", "signal": -63, "secured": True, "current": False},
    {"ssid": "Aurora-Diner-Guest", "signal": -71, "secured": True, "current": False},
    {"ssid": "TMobile-5G", "signal": -78, "secured": True, "current": False},
    {"ssid": "xfinitywifi", "signal": -82, "secured": False, "current": False},
]


@api_router.get("/wifi/status")
async def wifi_status() -> dict:
    return _WIFI_STATE | {"ts": datetime.now(timezone.utc).isoformat()}


@api_router.get("/wifi/scan")
async def wifi_scan() -> dict:
    # Slight signal jitter each scan
    nets = []
    for n in _WIFI_NETWORKS:
        nets.append(n | {"signal": n["signal"] + random.randint(-3, 3)})
    return {"networks": nets, "ts": datetime.now(timezone.utc).isoformat()}


@api_router.post("/wifi/connect")
async def wifi_connect(req: WifiConnectRequest) -> dict:
    match = next((n for n in _WIFI_NETWORKS if n["ssid"] == req.ssid), None)
    if not match:
        raise HTTPException(status_code=404, detail="Network not in scan cache")
    if match["secured"] and not req.password:
        raise HTTPException(status_code=400, detail="Password required for this network")
    _WIFI_STATE["connected"] = True
    _WIFI_STATE["ssid"] = req.ssid
    _WIFI_STATE["ip"] = f"10.42.0.{random.randint(2, 254)}"
    for n in _WIFI_NETWORKS:
        n["current"] = n["ssid"] == req.ssid
    return {"ok": True, "connected_to": req.ssid, "ip": _WIFI_STATE["ip"]}


# ---------------------------------------------------------------------------
# Plugins + tunnel
# ---------------------------------------------------------------------------
_PLUGINS = [
    {"name": "battery-monitor", "version": "1.4.2", "status": "healthy", "last_seen": "just now"},
    {"name": "solar-mppt", "version": "0.9.7", "status": "healthy", "last_seen": "just now"},
    {"name": "victron-bridge", "version": "2.1.0", "status": "healthy", "last_seen": "2s ago"},
    {"name": "camera-webcam", "version": "0.3.1", "status": "degraded", "last_seen": "18s ago"},
    {"name": "wifi-manager", "version": "1.0.5", "status": "healthy", "last_seen": "just now"},
    {"name": "poi-cache", "version": "0.5.0", "status": "healthy", "last_seen": "cached"},
]


@api_router.get("/plugins")
async def plugins() -> dict:
    return {"plugins": _PLUGINS, "ts": datetime.now(timezone.utc).isoformat()}


@api_router.get("/tunnel/status")
async def tunnel_status() -> dict:
    return {
        "active": True,
        "provider": "cloudflared",
        "public_url": "https://bongo-van-42.trycloudflare.com",
        "latency_ms": random.randint(40, 90),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Settings (in-memory)
# ---------------------------------------------------------------------------
_SETTINGS: dict[str, Any] = {"theme": "dark", "password_gate": True}


@api_router.get("/settings")
async def get_settings() -> dict:
    return _SETTINGS


@api_router.post("/settings")
async def update_settings(req: SettingsUpdate) -> dict:
    if req.theme is not None:
        _SETTINGS["theme"] = req.theme
    if req.password_gate is not None:
        _SETTINGS["password_gate"] = req.password_gate
    return _SETTINGS


# ---------------------------------------------------------------------------
# App wire-up
# ---------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    asyncio.create_task(_sim_loop())
    logger.info("bongo backend ready")


@app.on_event("shutdown")
async def _shutdown() -> None:
    mongo_client.close()
