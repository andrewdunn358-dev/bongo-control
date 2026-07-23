from app.plugins.renogy_mppt.plugin import RenogyMPPTPlugin

# Discovery convention read by PluginManager.discover().
PLUGIN_CLASSES = [RenogyMPPTPlugin]

__all__ = ["RenogyMPPTPlugin", "PLUGIN_CLASSES"]
