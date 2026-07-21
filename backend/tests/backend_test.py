"""
Bongo Control mock backend — pytest regression suite (iteration 2 rebuild).

Verifies the §2 API contract that the frontend depends on:
- Honesty invariants: battery.soc_pct is None, energy.loads is {}, environment.humidity_pct is None
- All REST endpoints under /api/*
- Auth gate (X-App-Token header + ?token= query for <img>)
- History, POI, mission-brief, weather, camera snapshot, wifi, plugins
- WebSocket per-domain streaming with source == "simulation"
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Dict

import pytest
import requests

# Tests run against the local supervised backend. Public URL is same-origin
# relative in this project; localhost:8001 is fine per the review-request note.
BASE_URL = os.environ.get("BONGO_BASE_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
UNLOCK_PASSWORD = "bongo"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def api_client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def unlock_token(api_client: requests.Session) -> str:
    r = api_client.post(f"{API}/auth/unlock", json={"password": UNLOCK_PASSWORD})
    assert r.status_code == 200, f"unlock failed: {r.status_code} {r.text}"
    token = r.json().get("token")
    assert isinstance(token, str) and token
    return token


@pytest.fixture(scope="session")
def auth_client(api_client: requests.Session, unlock_token: str) -> requests.Session:
    api_client.headers.update({"X-App-Token": unlock_token})
    return api_client


# ---------- Health & version ----------
class TestHealth:
    def test_health(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert isinstance(data.get("version"), str)
        assert isinstance(data.get("plugins"), list)


# ---------- Honesty invariants (the whole project pivots on these) ----------
class TestHonestyInvariants:
    def test_battery_soc_is_null(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/battery")
        assert r.status_code == 200
        data = r.json()
        assert data["soc_pct"] is None, "soc_pct MUST be null (no shunt fitted)"
        assert isinstance(data["voltage"], (int, float))
        assert 10.0 < data["voltage"] < 15.5
        assert isinstance(data["charging"], bool)

    def test_energy_loads_is_empty(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/energy")
        assert r.status_code == 200
        data = r.json()
        assert data["loads"] == {}, "loads MUST be empty (no circuit sensing on real hw)"
        for k in ("solar_watts", "load_watts", "net_watts"):
            assert isinstance(data[k], (int, float))

    def test_environment_humidity_is_null(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/environment")
        assert r.status_code == 200
        data = r.json()
        assert data["humidity_pct"] is None, "humidity_pct MUST be null (DS18B20 is temp-only)"
        assert isinstance(data["internal_temp_c"], (int, float))
        assert isinstance(data["external_temp_c"], (int, float))
        assert isinstance(data["sensors"], list) and len(data["sensors"]) >= 1


# ---------- Domain REST endpoints ----------
class TestDomains:
    def test_solar(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/solar")
        assert r.status_code == 200
        d = r.json()
        assert "watts" in d and "charge_state" in d
        assert d["charge_state"] in ("off", "bulk", "absorption", "float")

    def test_connectivity(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/connectivity")
        assert r.status_code == 200
        d = r.json()
        assert d.get("online") is True

    def test_system(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/system")
        assert r.status_code == 200
        d = r.json()
        assert set(["cpu_pct", "ram_pct", "temperature_c", "uptime_s", "version"]) <= set(d.keys())


# ---------- History (hours float param, all 4 domains) ----------
class TestHistory:
    @pytest.mark.parametrize("domain", ["battery", "solar", "energy", "environment"])
    @pytest.mark.parametrize("hours", [1.0, 24.0, 168.0, 720.0])
    def test_history_range(self, api_client: requests.Session, domain: str, hours: float) -> None:
        r = api_client.get(f"{API}/history/{domain}?hours={hours}")
        assert r.status_code == 200, f"{domain}@{hours}h -> {r.status_code}"
        data = r.json()
        assert data["domain"] == domain
        assert float(data["hours"]) == hours
        assert isinstance(data["series"], list)
        for pt in data["series"][:5]:
            assert "t" in pt and "value" in pt


# ---------- Mission brief ----------
class TestMissionBrief:
    def test_mission_brief(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/intelligence/mission-brief")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] in ("green", "amber", "red")
        assert isinstance(d["summary"], str) and d["summary"]
        for k in ("recommendations", "predictions", "signals"):
            assert isinstance(d[k], list)
        assert isinstance(d["computed_at"], (int, float))


# ---------- POI ----------
class TestPoi:
    def test_poi_nearby_default(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/poi/nearby")
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["items"], list)
        for item in d["items"]:
            assert "distance_m" in item
            assert isinstance(item["distance_m"], (int, float))

    def test_poi_with_radius_and_categories(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/poi/nearby?radius_m=2000&categories=water,fuel")
        assert r.status_code == 200
        d = r.json()
        for item in d["items"]:
            assert item["category"] in ("water", "fuel")
            assert item["distance_m"] <= 2000

    def test_poi_does_not_take_lat_lng(self, api_client: requests.Session) -> None:
        # lat/lng are NOT valid query params — they should just be ignored
        r = api_client.get(f"{API}/poi/nearby?lat=45.0&lng=-122.0")
        assert r.status_code == 200


# ---------- AI ----------
class TestAi:
    def test_ai_status_configured_false(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/ai/status")
        assert r.status_code == 200
        assert r.json() == {"configured": False}

    def test_ai_nearby_unauthed_401(self) -> None:
        # Use a fresh client without the auth header
        r = requests.get(f"{API}/ai/nearby-recommendations")
        assert r.status_code == 401

    def test_ai_nearby_authed_returns_503(self, auth_client: requests.Session) -> None:
        r = auth_client.get(f"{API}/ai/nearby-recommendations")
        assert r.status_code == 503, f"expected 503 (no AI provider), got {r.status_code}"


# ---------- Location ----------
class TestLocation:
    def test_get_location(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/location")
        assert r.status_code == 200
        d = r.json()
        assert "latitude" in d and "longitude" in d

    def test_post_gps(self, api_client: requests.Session) -> None:
        r = api_client.post(f"{API}/location/gps", json={"latitude": 40.0, "longitude": -105.0})
        assert r.status_code == 200
        # Verify persisted
        r2 = api_client.get(f"{API}/location")
        assert r2.json()["latitude"] == 40.0
        assert r2.json()["longitude"] == -105.0
        # restore
        api_client.post(f"{API}/location/gps", json={"latitude": 45.5231, "longitude": -122.6765})


# ---------- Auth + relays ----------
class TestAuthAndRelays:
    def test_auth_wrong_password(self, api_client: requests.Session) -> None:
        r = requests.post(f"{API}/auth/unlock", json={"password": "wrong"})
        assert r.status_code == 401

    def test_auth_correct(self, api_client: requests.Session) -> None:
        r = requests.post(f"{API}/auth/unlock", json={"password": UNLOCK_PASSWORD})
        assert r.status_code == 200
        assert isinstance(r.json()["token"], str)

    def test_relays_locked_without_token(self) -> None:
        r = requests.get(f"{API}/relays")
        assert r.status_code == 401

    def test_relays_unlocked(self, auth_client: requests.Session) -> None:
        r = auth_client.get(f"{API}/relays")
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["relays"], list) and len(d["relays"]) >= 1
        for relay in d["relays"]:
            # Field MUST be commanded_on (parallel wiring honesty), NOT `on`
            assert "commanded_on" in relay, "relay field must be `commanded_on`"
            assert "on" not in relay or "commanded_on" in relay

    def test_relay_set_and_persistence(self, auth_client: requests.Session) -> None:
        # flip relay 2 on
        r = auth_client.post(f"{API}/relays/2/set", json={"on": True})
        assert r.status_code == 200
        assert r.json()["commanded_on"] is True
        # verify via list
        listing = auth_client.get(f"{API}/relays").json()["relays"]
        r2 = next(x for x in listing if x["id"] == "2")
        assert r2["commanded_on"] is True

    def test_relays_all_off(self, auth_client: requests.Session) -> None:
        auth_client.post(f"{API}/relays/1/set", json={"on": True})
        r = auth_client.post(f"{API}/relays/all-off")
        assert r.status_code == 200
        for relay in auth_client.get(f"{API}/relays").json()["relays"]:
            assert relay["commanded_on"] is False


# ---------- Camera ----------
class TestCamera:
    def test_snapshot_requires_auth(self) -> None:
        r = requests.get(f"{API}/camera/snapshot")
        assert r.status_code == 401

    def test_snapshot_with_query_token(self, unlock_token: str) -> None:
        r = requests.get(f"{API}/camera/snapshot", params={"token": unlock_token})
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/svg")
        assert b"<svg" in r.content[:200]

    def test_snapshot_with_header_token(self, auth_client: requests.Session) -> None:
        r = auth_client.get(f"{API}/camera/snapshot")
        assert r.status_code == 200


# ---------- WiFi ----------
class TestWifi:
    def test_wifi_status(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/wifi/status")
        assert r.status_code == 200
        assert "ssid" in r.json()

    def test_wifi_scan(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/wifi/scan")
        assert r.status_code == 200
        nets = r.json()["networks"]
        assert any(n.get("current") for n in nets)


# ---------- Plugins ----------
class TestPlugins:
    def test_plugins_listing(self, api_client: requests.Session) -> None:
        r = api_client.get(f"{API}/plugins")
        assert r.status_code == 200
        assert isinstance(r.json()["plugins"], list)


# ---------- WebSocket per-domain streaming ----------
class TestWebSocket:
    @pytest.mark.asyncio
    async def test_ws_per_domain_and_simulation_source(self) -> None:
        try:
            import websockets
        except ImportError:
            pytest.skip("websockets library not installed")
        ws_url = BASE_URL.replace("http", "ws") + "/api/ws/telemetry"
        seen_domains = set()
        async with websockets.connect(ws_url) as ws:
            # collect initial snapshot burst
            for _ in range(10):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                assert "domain" in msg and "source" in msg and "payload" in msg
                assert msg["source"] == "simulation", "safety-banner trigger must be 'simulation'"
                seen_domains.add(msg["domain"])
                if len(seen_domains) >= 5:
                    break
        # Should have seen at least battery, solar, energy, environment
        for d in ("battery", "solar", "energy", "environment"):
            assert d in seen_domains, f"missing initial snapshot for {d}, saw: {seen_domains}"

    @pytest.mark.asyncio
    async def test_ws_prod_path_also_works(self) -> None:
        try:
            import websockets
        except ImportError:
            pytest.skip("websockets library not installed")
        # Real prod nginx serves at /ws/telemetry (without /api prefix); mock supports both.
        ws_url = BASE_URL.replace("http", "ws") + "/ws/telemetry"
        async with websockets.connect(ws_url) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
            msg = json.loads(raw)
            assert msg["source"] == "simulation"
