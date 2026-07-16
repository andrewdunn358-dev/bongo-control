from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health, settings as settings_routes, telemetry
from app.api.websocket import router as websocket_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.db.database import init_db
from app.plugins.base import registry
from app.plugins.simulation import SimulationEngine
from app.telemetry.bus import bus

configure_logging()
logger = logging.getLogger("vanos.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (environment=%s, simulation_mode=%s)", settings.app_name, settings.environment, settings.simulation_mode)

    init_db()

    if settings.simulation_mode:
        registry.register(SimulationEngine(bus))
    # Real hardware plugins get registered here too, e.g.:
    # if not settings.simulation_mode:
    #     registry.register(VictronPlugin(bus))
    #     registry.register(BatteryShuntPlugin(bus))

    await registry.start_all()
    logger.info("All plugins started")

    yield

    logger.info("Shutting down, stopping plugins")
    await registry.stop_all()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(telemetry.router)
app.include_router(settings_routes.router)
app.include_router(websocket_router)


@app.get("/")
async def root() -> dict:
    return {"service": settings.app_name, "docs": "/docs", "websocket": "/ws/telemetry"}
