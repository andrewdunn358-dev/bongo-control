from app.plugins.onewire_temp.plugin import OneWireTempPlugin

# Discovery convention read by PluginManager.discover().
PLUGIN_CLASSES = [OneWireTempPlugin]

__all__ = ["OneWireTempPlugin", "PLUGIN_CLASSES"]
