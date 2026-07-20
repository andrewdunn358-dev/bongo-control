import { Palette, Sun, Moon, MonitorSmartphone } from "lucide-react";
import Card from "../../components/Cards/Card";
import { useTheme, type ThemeMode } from "../../context/ThemeContext";

const OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
  { mode: "dark", label: "Dark", icon: <Moon size={18} />, description: "Always dark, regardless of device settings" },
  { mode: "light", label: "Light", icon: <Sun size={18} />, description: "Always light, regardless of device settings" },
  { mode: "system", label: "System", icon: <MonitorSmartphone size={18} />, description: "Follows this device's display setting" },
];

export default function Appearance() {
  const { mode, setMode } = useTheme();

  return (
    <Card label="Appearance" icon={<Palette size={14} />}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Choose how Bongo Control looks on this device.</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {OPTIONS.map((option) => {
            const active = mode === option.mode;
            return (
              <button
                key={option.mode}
                onClick={() => setMode(option.mode)}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all duration-150 active:scale-95 ${
                  active
                    ? "border-battery/30 bg-battery/10 text-text-primary"
                    : "border-ink/[0.08] bg-ink/[0.03] text-text-secondary hover:bg-ink/[0.06]"
                }`}
              >
                <span className={active ? "text-battery" : "text-text-muted"}>{option.icon}</span>
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs text-text-muted">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
