from app.services.battery_service import BatteryService
from app.services.configuration_service import configuration_service
from app.services.history_service import HistoryService
from app.services.location_service import LocationService
from app.services.notification_service import notification_service
from app.services.poi_service import poi_service
from app.services.power_budget_service import PowerBudgetService
from app.services.telemetry_service import telemetry_service

battery_service = BatteryService(telemetry_service, notification_service)
history_service = HistoryService(telemetry_service)
location_service = LocationService(configuration_service)
power_budget_service = PowerBudgetService(telemetry_service, history_service)

__all__ = [
    "configuration_service",
    "telemetry_service",
    "notification_service",
    "battery_service",
    "history_service",
    "location_service",
    "power_budget_service",
    "poi_service",
]
