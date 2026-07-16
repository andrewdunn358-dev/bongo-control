from app.plugins.simulation.engine import SimulationEngine

# Discovery convention read by PluginManager.discover() — every plugin
# subpackage exposes its concrete Plugin class(es) here.
PLUGIN_CLASSES = [SimulationEngine]

__all__ = ["SimulationEngine", "PLUGIN_CLASSES"]
