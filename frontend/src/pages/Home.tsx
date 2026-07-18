import { motion } from "framer-motion";
import { BatteryMedium, Sun, Thermometer, Wifi, WifiOff, CloudSun } from "lucide-react";
import Card from "../components/Cards/Card";
import MetricCard from "../components/Cards/MetricCard";
import LiveIndicator from "../components/Cards/LiveIndicator";
import PowerFlowDiagram from "../components/PowerFlow/PowerFlowDiagram";
import PowerBudgetCard from "../components/Cards/PowerBudgetCard";
import RecentEventsCard from "../components/Cards/RecentEventsCard";
import { useTelemetry } from "../context/TelemetryContext";

export default function Home() {
  const { state, connected } = useTelemetry();
  const battery = state.battery?.payload;
  const solar = state.solar?.payload;
  const environment = state.environment?.payload;
  const connectivity = state.connectivity?.payload;
  const weather = state.weather?.payload;

  const heroLastUpdated = state.battery?.timestamp ?? state.solar?.timestamp ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-lg font-semibold text-text-primary md:text-xl"
        >
          Good to go
        </motion.h1>
        <LiveIndicator lastUpdated={heroLastUpdated} connected={connected} />
      </div>

      {/* Hero: the Energy Flow diagram is the flagship visual - given
          room to breathe and stand apart from the grid of stat tiles
          below it, rather than reading as just another equal-weight card. */}
      <Card label="Energy Flow" accent="solar" index={0} className="md:pb-2">
        <PowerFlowDiagram />
      </Card>

      {/* Primary telemetry - Battery/Solar are what someone checks first,
          given more visual weight (larger type) than the secondary row below. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard
          index={1}
          label="Battery"
          icon={<BatteryMedium size={16} />}
          accent="battery"
          size="large"
          value={battery ? (battery.soc_pct !== null ? battery.soc_pct : battery.voltage) : "—"}
          unit={battery ? (battery.soc_pct !== null ? "%" : "V") : ""}
          decimals={battery && battery.soc_pct === null ? 2 : 0}
          subtext={battery ? (battery.charging ? "Charging" : "Discharging") : undefined}
        />
        <MetricCard
          index={2}
          label="Solar"
          icon={<Sun size={16} />}
          accent="solar"
          size="large"
          value={solar ? solar.watts : "—"}
          unit={solar ? "W" : ""}
          subtext={
            solar?.cloud_cover_pct !== undefined
              ? `${Math.round(solar.cloud_cover_pct)}% cloud cover`
              : (solar?.charge_state ?? undefined)
          }
        />
      </div>

      {/* Secondary telemetry - supporting context, deliberately more compact
          so it doesn't compete with Battery/Solar above. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          index={3}
          label="Environment"
          icon={<Thermometer size={14} />}
          value={environment ? environment.internal_temp_c : "—"}
          unit={environment ? "°C" : ""}
          subtext={environment ? `Outside ${Math.round(environment.external_temp_c)}°C` : undefined}
        />
        <MetricCard
          index={4}
          label="Connectivity"
          icon={connectivity?.online ? <Wifi size={14} /> : <WifiOff size={14} />}
          value={connectivity ? (connectivity.online ? "Online" : "Offline") : "—"}
          subtext={connectivity ? `${connectivity.signal_strength_pct}% signal` : undefined}
        />
        <MetricCard
          index={5}
          label="Weather"
          icon={<CloudSun size={14} />}
          value={weather?.current_temp_c != null ? weather.current_temp_c : "—"}
          unit={weather?.current_temp_c != null ? "°C" : ""}
          subtext={weather ? weather.today.weather_description : undefined}
        />
      </div>

      {/* Power Budget is the "so what does this mean for me" summary -
          given more room than Recent Events, which is a shorter supporting list. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PowerBudgetCard index={6} />
        </div>
        <RecentEventsCard index={7} />
      </div>
    </div>
  );
}
