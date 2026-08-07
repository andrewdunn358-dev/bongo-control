from app.plugins.gps_serial.plugin import GpsSerialPlugin

# Discovery convention read by PluginManager.discover().
PLUGIN_CLASSES = [GpsSerialPlugin]

__all__ = ["GpsSerialPlugin", "PLUGIN_CLASSES"]
