from app.services.battery_service import BatteryService
from app.services.configuration_service import configuration_service
from app.services.history_service import HistoryService
from app.services.notification_service import notification_service
from app.services.telemetry_service import telemetry_service

battery_service = BatteryService(telemetry_service, notification_service)
history_service = HistoryService(telemetry_service)

__all__ = [
    "configuration_service",
    "telemetry_service",
    "notification_service",
    "battery_service",
    "history_service",
]
