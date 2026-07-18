import { Battery, Moon, Clock, CloudSun } from "lucide-react";
import { motion } from "framer-motion";
import Card from "./Card";
import { useTelemetry } from "../../context/TelemetryContext";

export default function PowerBudgetCard({ index = 0 }: { index?: number }) {
  const { state } = useTelemetry();
  const budget = state.system?.payload.power_budget;
  const outlook = state.system?.payload.tomorrow_outlook;

  const rows = budget
    ? [
        {
          icon: Moon,
          text:
            budget.heater_all_night_possible === null
              ? "Heater all night: not enough data yet"
              : `Heater all night: ${budget.heater_all_night_possible ? "Yes" : "No"}`,
        },
        {
          icon: Clock,
          text:
            budget.estimated_runtime_hours !== null
              ? `Runtime remaining: ~${budget.estimated_runtime_hours}h`
              : budget.note || "Runtime: not enough data yet",
        },
      ]
    : [];

  return (
    <Card label="Power Budget" icon={<Battery size={14} />} accent="battery" index={index}>
      {budget ? (
        <div className="space-y-4">
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

          {outlook && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex items-start gap-2.5 rounded-lg bg-solar/10 p-3"
            >
              <CloudSun size={16} className="mt-0.5 shrink-0 text-solar" />
              <span className="text-sm text-text-primary">{outlook.recommendation}</span>
            </motion.div>
          )}
        </div>
      ) : (
        <span className="text-sm text-text-muted">Waiting for data...</span>
      )}
    </Card>
  );
}
