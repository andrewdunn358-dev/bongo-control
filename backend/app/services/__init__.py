from app.services.battery_service import BatteryService
from app.services.configuration_service import configuration_service
from app.services.notification_service import notification_service
from app.services.telemetry_service import telemetry_service

battery_service = BatteryService(telemetry_service, notification_service)

__all__ = [
    "configuration_service",
    "telemetry_service",
    "notification_service",
    "battery_service",
]
