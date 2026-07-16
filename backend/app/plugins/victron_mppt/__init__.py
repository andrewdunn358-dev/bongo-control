from app.plugins.victron_mppt.plugin import VictronMPPTPlugin

# Discovery convention read by PluginManager.discover().
PLUGIN_CLASSES = [VictronMPPTPlugin]

__all__ = ["VictronMPPTPlugin", "PLUGIN_CLASSES"]
