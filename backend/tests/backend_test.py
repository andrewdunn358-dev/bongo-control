"""Bongo Control — backend API + WS tests.

Runs against REACT_APP_BACKEND_URL from /app/frontend/.env so we exercise
the same URL the browser uses (ingress -> :8001).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

import pytest
import requests
import websockets


def _load_frontend_env() -> str:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("REACT_APP_BACKEND_URL not found in frontend/.env")


BASE_URL = _load_frontend_env().rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- health -------------------------------------------------------------
def test_health(client):
    r = client.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "ts" in body


def test_root(client):
    r = client.get(f"{API}/", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "bongo-control"


# --- telemetry ----------------------------------------------------------
def test_telemetry_snapshot_shape(client):
    r = client.get(f"{API}/telemetry/snapshot", timeout=10)
    assert r.status_code == 200
    body = r.json()
    for key in ("battery", "solar", "load", "climate", "tanks", "ts"):
        assert key in body, f"missing key {key}"
    battery = body["battery"]
    for k in ("soc", "voltage", "current", "power", "status"):
        assert k in battery
    assert 0 <= battery["soc"] <= 100
    assert battery["status"] in ("charging", "discharging")
    solar = body["solar"]
    for k in ("power", "voltage", "current", "today_kwh"):
        assert k in solar
    load = body["load"]
    for k in ("power", "inverter_on", "heater_on", "fridge_on"):
        assert k in load
    climate = body["climate"]
    assert "interior_c" in climate and "exterior_c" in climate
    tanks = body["tanks"]
    assert "water_pct" in tanks


def test_websocket_streams_frames():
    """Connect to /api/ws/telemetry via wss and expect >=2 frames in ~4s."""
    ws_url = re.sub(r"^http", "ws", BASE_URL) + "/api/ws/telemetry"

    async def _run():
        frames = []
        async with websockets.connect(ws_url, open_timeout=10, close_timeout=5) as ws:
            for _ in range(3):
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                assert "battery" in data and "solar" in data
                frames.append(data)
        return frames

    frames = asyncio.run(_run())
    assert len(frames) >= 2


# --- mission brief ------------------------------------------------------
def test_mission_brief(client):
    r = client.get(f"{API}/intelligence/mission-brief", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("green", "amber", "red")
    for k in ("runtime_hours", "heater_hours", "solar_forecast_kwh",
              "recommendations", "highlights", "generated_at"):
        assert k in body
    assert isinstance(body["recommendations"], list) and len(body["recommendations"]) >= 1
    h = body["highlights"]
    for k in ("battery_soc", "solar_now_w", "load_now_w", "interior_c"):
        assert k in h


# --- POI + AI -----------------------------------------------------------
def test_poi_nearby_sorted_by_distance(client):
    r = client.get(f"{API}/poi/nearby", params={"lat": 45.5231, "lng": -122.6765}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and len(body["items"]) > 0
    dists = [it["distance_km"] for it in body["items"]]
    assert dists == sorted(dists), "items must be sorted by distance"
    it = body["items"][0]
    for k in ("id", "name", "type", "lat", "lng", "distance_km", "note", "offline_cached"):
        assert k in it
    assert it["offline_cached"] is True


def test_ai_nearby_picks(client):
    r = client.get(f"{API}/ai/nearby-recommendations",
                   params={"lat": 45.5231, "lng": -122.6765}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "summary" in body and isinstance(body["summary"], str)
    assert "picks" in body and isinstance(body["picks"], list)
    assert len(body["picks"]) >= 1
    for pick in body["picks"]:
        assert "poi" in pick and "reason" in pick


# --- Weather ------------------------------------------------------------
def test_weather_forecast(client):
    r = client.get(f"{API}/weather/forecast",
                   params={"lat": 45.5231, "lng": -122.6765}, timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert "current" in body
    assert "daily" in body
    assert "solar_outlook" in body
    outlook = body["solar_outlook"]
    assert "today" in outlook and "tomorrow" in outlook
    assert isinstance(outlook["today"], list)


# --- Auth / Camera ------------------------------------------------------
def test_auth_unlock_correct_password(client):
    r = client.post(f"{API}/auth/unlock", json={"password": "bongo"}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 0
    assert "expires_in" in body


def test_auth_unlock_wrong_password(client):
    r = client.post(f"{API}/auth/unlock", json={"password": "wrong"}, timeout=10)
    assert r.status_code == 401


def test_camera_snapshot_locked(client):
    r = client.get(f"{API}/camera/snapshot", timeout=10)
    assert r.status_code == 401


def test_camera_snapshot_unlocked(client):
    tok = client.post(f"{API}/auth/unlock", json={"password": "bongo"}, timeout=10).json()["token"]
    r = client.get(f"{API}/camera/snapshot", params={"token": tok}, timeout=10)
    assert r.status_code == 200
    assert "image/svg" in r.headers.get("Content-Type", "")
    assert b"<svg" in r.content


# --- History -----------------------------------------------------------
@pytest.mark.parametrize("domain,rng,expected_points", [
    ("battery", "1h", 60),
    ("solar", "24h", 96),
    ("load", "7d", 168),
    ("temp", "30d", 180),
])
def test_history(client, domain, rng, expected_points):
    r = client.get(f"{API}/history/{domain}", params={"range": rng}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["domain"] == domain
    assert body["range"] == rng
    assert isinstance(body["series"], list)
    assert len(body["series"]) == expected_points
    pt = body["series"][0]
    assert "t" in pt and "value" in pt


def test_history_invalid_domain(client):
    r = client.get(f"{API}/history/foo", params={"range": "24h"}, timeout=10)
    assert r.status_code == 404


def test_history_invalid_range(client):
    r = client.get(f"{API}/history/battery", params={"range": "9d"}, timeout=10)
    assert r.status_code == 400


# --- WiFi ---------------------------------------------------------------
def test_wifi_status(client):
    r = client.get(f"{API}/wifi/status", timeout=10)
    assert r.status_code == 200
    body = r.json()
    for k in ("connected", "ssid", "ip"):
        assert k in body


def test_wifi_scan(client):
    r = client.get(f"{API}/wifi/scan", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "networks" in body and len(body["networks"]) > 0
    for n in body["networks"]:
        for k in ("ssid", "signal", "secured", "current"):
            assert k in n


def test_wifi_connect_secured_requires_password(client):
    r = client.post(f"{API}/wifi/connect", json={"ssid": "Starlink_Cabin"}, timeout=10)
    assert r.status_code == 400


def test_wifi_connect_open_ok(client):
    r = client.post(f"{API}/wifi/connect", json={"ssid": "CampWiFi_Free"}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["connected_to"] == "CampWiFi_Free"


def test_wifi_connect_unknown_ssid(client):
    r = client.post(f"{API}/wifi/connect",
                    json={"ssid": "TEST_Nope-Never", "password": "x"}, timeout=10)
    assert r.status_code == 404


# --- Plugins / Tunnel / Settings ---------------------------------------
def test_plugins(client):
    r = client.get(f"{API}/plugins", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "plugins" in body and len(body["plugins"]) > 0


def test_tunnel_status(client):
    r = client.get(f"{API}/tunnel/status", timeout=10)
    assert r.status_code == 200
    body = r.json()
    for k in ("active", "provider", "public_url", "latency_ms"):
        assert k in body


def test_settings_get_and_update(client):
    r = client.get(f"{API}/settings", timeout=10)
    assert r.status_code == 200
    original = r.json()
    assert "theme" in original and "password_gate" in original

    new_theme = "light" if original["theme"] == "dark" else "dark"
    r2 = client.post(f"{API}/settings", json={"theme": new_theme}, timeout=10)
    assert r2.status_code == 200
    assert r2.json()["theme"] == new_theme

    # verify persistence via GET
    r3 = client.get(f"{API}/settings", timeout=10)
    assert r3.json()["theme"] == new_theme

    # restore
    client.post(f"{API}/settings", json={"theme": original["theme"]}, timeout=10)
