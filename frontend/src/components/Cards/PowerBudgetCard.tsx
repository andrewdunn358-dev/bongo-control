import { Battery, Moon, Clock, Sun } from "lucide-react";
import { motion } from "framer-motion";
import Card from "./Card";
import { useTelemetry } from "../../context/TelemetryContext";

export default function PowerBudgetCard({ index = 0 }: { index?: number }) {
  const { state } = useTelemetry();
  const budget = state.system?.payload.power_budget;

  const rows = budget
    ? [
        { icon: Moon, text: `Heater all night: ${budget.heater_all_night_possible ? "Yes" : "No"}` },
        { icon: Clock, text: `Runtime remaining: ~${budget.estimated_runtime_hours}h` },
        { icon: Sun, text: `Recovery tomorrow: ~${budget.estimated_recovery_tomorrow_pct}%` },
      ]
    : [];

  return (
    <Card label="Power Budget" icon={<Battery size={14} />} accent="battery" index={index}>
      {budget ? (
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const Icon = row.icon;
            return (
              <motion.li
                key={row.text}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08 }}
                className="flex items-center gap-2.5 text-sm text-text-primary"
              >
                <Icon size={16} className="shrink-0 text-battery" />
                {row.text}
              </motion.li>
            );
          })}
        </ul>
      ) : (
        <span className="text-sm text-text-muted">Waiting for data...</span>
      )}
    </Card>
  );
}
