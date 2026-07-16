import { motion } from "framer-motion";
import { BatteryMedium, Sun, Thermometer, Wifi, WifiOff } from "lucide-react";
import Card from "../components/Cards/Card";
import MetricCard from "../components/Cards/MetricCard";
import PowerFlowDiagram from "../components/PowerFlow/PowerFlowDiagram";
import PowerBudgetCard from "../components/Cards/PowerBudgetCard";
import VehicleHealthCard from "../components/Cards/VehicleHealthCard";
import RecentEventsCard from "../components/Cards/RecentEventsCard";
import { useTelemetry } from "../context/TelemetryContext";

export default function Home() {
  const { state } = useTelemetry();
  const battery = state.battery?.payload;
  const solar = state.solar?.payload;
  const environment = state.environment?.payload;
  const connectivity = state.connectivity?.payload;

  return (
    <div className="space-y-5">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-lg font-semibold text-text-primary md:text-xl"
      >
        Good to go
      </motion.h1>

      <Card label="Energy Flow" accent="solar" index={0}>
        <PowerFlowDiagram />
      </Card>

      {/* Quick Status — at-a-glance readouts, detail lives on each domain's own page */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          index={1}
          label="Battery"
          icon={<BatteryMedium size={14} />}
          accent="battery"
          value={battery ? `${Math.round(battery.soc_pct)}%` : "—"}
          subtext={battery ? (battery.charging ? "Charging" : "Discharging") : undefined}
        />
        <MetricCard
          index={2}
          label="Solar"
          icon={<Sun size={14} />}
          accent="solar"
          value={solar ? `${Math.round(solar.watts)}W` : "—"}
          subtext={solar ? `${Math.round(solar.cloud_cover_pct)}% cloud cover` : undefined}
        />
        <MetricCard
          index={3}
          label="Environment"
          icon={<Thermometer size={14} />}
          value={environment ? `${Math.round(environment.internal_temp_c)}°C` : "—"}
          subtext={environment ? `Outside ${Math.round(environment.external_temp_c)}°C` : undefined}
        />
        <MetricCard
          index={4}
          label="Connectivity"
          icon={connectivity?.online ? <Wifi size={14} /> : <WifiOff size={14} />}
          value={connectivity ? (connectivity.online ? "Online" : "Offline") : "—"}
          subtext={connectivity ? `${connectivity.signal_strength_pct}% signal` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PowerBudgetCard index={5} />
        <VehicleHealthCard index={6} />
        <RecentEventsCard index={7} />
      </div>
    </div>
  );
}
