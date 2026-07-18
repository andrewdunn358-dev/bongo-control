from app.plugins.weather.plugin import WeatherPlugin

# Discovery convention read by PluginManager.discover().
PLUGIN_CLASSES = [WeatherPlugin]

__all__ = ["WeatherPlugin", "PLUGIN_CLASSES"]
