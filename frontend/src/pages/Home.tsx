import { motion } from "framer-motion";
import Card from "../components/Cards/Card";
import PowerFlowDiagram from "../components/PowerFlow/PowerFlowDiagram";
import PowerBudgetCard from "../components/Cards/PowerBudgetCard";
import VehicleHealthCard from "../components/Cards/VehicleHealthCard";
import RecentEventsCard from "../components/Cards/RecentEventsCard";

export default function Home() {
  return (
    <div className="space-y-5">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-lg font-semibold text-text-primary md:text-xl"
      >
        Good to go
      </motion.h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-3">
          <Card label="Power Flow" accent="solar" index={0}>
            <PowerFlowDiagram />
          </Card>
        </div>

        <PowerBudgetCard index={1} />
        <VehicleHealthCard index={2} />
        <RecentEventsCard index={3} />
      </div>
    </div>
  );
}
