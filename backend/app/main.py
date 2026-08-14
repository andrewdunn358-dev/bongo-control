from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ai as ai_routes
from app.api.routes import auth as auth_routes
from app.api.routes import camera as camera_routes
from app.api.routes import config as config_routes
from app.api.routes import coverage as coverage_routes
from app.api.routes import modem as modem_routes
from app.api.routes import intelligence as intelligence_routes
from app.api.routes import internet_radio as internet_radio_routes
from app.api.routes import radio_directory as radio_directory_routes
from app.api.routes import roof as roof_routes
from app.api.routes import system as system_routes
from app.api.routes import places as places_routes
from app.api.routes import backup as backup_routes
from app.api.routes import voice as voice_routes
from app.api.routes import voice_control as voice_control_routes
from app.api.routes import relays as relay_routes
from app.api.routes import health, location as location_routes, plugins as plugins_routes, poi as poi_routes, settings as settings_routes, telemetry, wifi as wifi_routes
from app.api.websocket import router as websocket_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.db.database import init_db
from app.intelligence.engine import IntelligenceEngine
from app.intelligence.providers.battery_signal import BatterySignalProvider
from app.intelligence.providers.power_predictions import PowerPredictionProvider
from app.intelligence.providers.solar_outlook import SolarOutlookSignalProvider
from app.intelligence.providers.solar_yield import SolarYieldSignalProvider
from app.intelligence.providers.solar_history import SolarHistorySignalProvider
from app.intelligence.runner import IntelligenceRunner
from app.plugins.manager import PluginManager
from app.services.roof_service import roof_service
from app.services.voice_control_service import voice_control_service
from app.services.internet_radio_service import internet_radio_service
from app.services.arrival_notification_service import arrival_notification_service
from app.services import battery_service, configuration_service, history_service, location_service, notification_service, power_budget_service, telemetry_service
from app.services.relay_service import relay_service
from app.telemetry.bus import bus

configure_logging()
logger = logging.getLogger("vanos.main")

plugin_manager = PluginManager(bus, configuration_service, notification_service)

# Signal/Prediction providers read telemetry the same way
# PowerBudgetService already does (telemetry_service.latest(domain)) -
# a future Water/Heating/Door-Sensor plugin adds itself here as one
# more provider, with zero changes to IntelligenceEngine's own code.
intelligence_engine = IntelligenceEngine(
    signal_providers=[
        BatterySignalProvider(telemetry_service),
        SolarOutlookSignalProvider(telemetry_service),
        SolarYieldSignalProvider(telemetry_service, location_service),
        SolarHistorySignalProvider(history_service),
    ],
    prediction_providers=[
        PowerPredictionProvider(telemetry_service, history_service),
    ],
)
intelligence_runner = IntelligenceRunner(telemetry_service, intelligence_engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (environment=%s)", settings.app_name, settings.environment)

    init_db()

    # Discovery is real: scans app/plugins/* for PLUGIN_CLASSES. A real
    # hardware plugin (Victron, battery shunt, ...) added later needs no
    # changes here — just a new package under app/plugins/.
    plugin_manager.discover_and_register()
    plugins_routes.set_manager(plugin_manager)
    location_routes.set_manager(plugin_manager)

    await plugin_manager.start_all()
    logger.info("Plugin manager started (%d plugin(s) registered)", len(plugin_manager.health()))

    await battery_service.start_monitoring()
    logger.info("Battery service monitoring started")

    await history_service.start()
    logger.info("History service started")

    await power_budget_service.start()
    logger.info("Power Budget service started")

    intelligence_routes.set_engine(intelligence_engine)
    await intelligence_runner.start()
    logger.info("Intelligence engine started")

    # Non-fatal if there's no GPIO hardware - relay control simply
    # reports itself unavailable rather than taking the backend down.
    relay_config = configuration_service.get("relays", {})
    relay_service.configure(
        channels=relay_config.get("channels"),
        active_high=relay_config.get("active_high", True),
    )
    relay_service.start()

    # Roof control is off unless explicitly enabled - a fresh install
    # must not be able to drive a roof motor before anyone has wired
    # or checked anything.
    roof_service.configure(configuration_service.get("roof", {}))

    # Started after relay_service and roof_service are both configured
    # above - voice control's safety boundary (excluding roof channels
    # from what it can control) reads roof_service.managed_channel_ids
    # at call time, so this ordering just needs roof_service to have
    # something configured by the time a voice command actually comes
    # in, not necessarily by this exact line. Silently does nothing if
    # no Groq key is configured yet - same "off until opted into"
    # pattern as the camera and GPS device passthrough.
    voice_control_service.start()

    # Proactively notices when the van has genuinely settled somewhere
    # new (not just moving) and surfaces a real AI recommendation as a
    # notification, without anyone tapping anything - see the module's
    # own docstring for the two independent cost safeguards (the
    # underlying recommendations service's own week-long cache, plus
    # this service's own last-notified-location tracking). Silently
    # does nothing if no Anthropic key is configured, same "off until
    # opted into" pattern as voice control above.
    await arrival_notification_service.start()

    yield

    logger.info("Shutting down")
    relay_service.stop()
    await roof_service.stop_all()
    await voice_control_service.stop()
    await arrival_notification_service.stop()
    internet_radio_service.stop()
    await intelligence_runner.stop()
    await power_budget_service.stop()
    await history_service.stop()
    await battery_service.stop_monitoring()
    await plugin_manager.stop_all()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # This app has no cookie-based auth/sessions at all (nothing in the
    # frontend ever sends credentials), so there's no security reason to
    # restrict by origin - and doing so was actively fragile in practice:
    # the exact-string allowlist broke depending on whether this was
    # accessed via localhost, 127.0.0.1, a LAN IP, or a Tailscale IP -
    # all functionally "the same machine" but different CORS origins.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(telemetry.router)
app.include_router(settings_routes.router)
app.include_router(plugins_routes.router)
app.include_router(config_routes.router)
app.include_router(system_routes.router)
app.include_router(location_routes.router)
app.include_router(places_routes.router)
app.include_router(backup_routes.router)
app.include_router(poi_routes.router)
app.include_router(coverage_routes.router)
app.include_router(modem_routes.router)
app.include_router(camera_routes.router)
app.include_router(wifi_routes.router)
app.include_router(auth_routes.router)
app.include_router(ai_routes.router)
app.include_router(intelligence_routes.router)
app.include_router(roof_routes.router)
app.include_router(voice_routes.router)
app.include_router(voice_control_routes.router)
app.include_router(relay_routes.router)
app.include_router(internet_radio_routes.router)
app.include_router(radio_directory_routes.router)
app.include_router(websocket_router)


@app.get("/")
async def root() -> dict:
    return {"service": settings.app_name, "docs": "/docs", "websocket": "/ws/telemetry"}
