from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import config as config_routes
from app.api.routes import health, plugins as plugins_routes, settings as settings_routes, telemetry
from app.api.websocket import router as websocket_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.db.database import init_db
from app.plugins.manager import PluginManager
from app.services import battery_service, configuration_service, notification_service
from app.telemetry.bus import bus

configure_logging()
logger = logging.getLogger("vanos.main")

plugin_manager = PluginManager(bus, configuration_service, notification_service)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (environment=%s)", settings.app_name, settings.environment)

    init_db()

    # Discovery is real: scans app/plugins/* for PLUGIN_CLASSES. A real
    # hardware plugin (Victron, battery shunt, ...) added later needs no
    # changes here — just a new package under app/plugins/.
    plugin_manager.discover_and_register()
    plugins_routes.set_manager(plugin_manager)

    await plugin_manager.start_all()
    logger.info("Plugin manager started (%d plugin(s) registered)", len(plugin_manager.health()))

    await battery_service.start_monitoring()
    logger.info("Battery service monitoring started")

    yield

    logger.info("Shutting down")
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
app.include_router(websocket_router)


@app.get("/")
async def root() -> dict:
    return {"service": settings.app_name, "docs": "/docs", "websocket": "/ws/telemetry"}
