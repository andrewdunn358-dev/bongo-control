import { Smartphone, CheckCircle2 } from "lucide-react";
import Card from "../../components/Cards/Card";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";

export default function General() {
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt();

  return (
    <Card label="Install App" icon={<Smartphone size={14} />} accent={installed ? "battery" : "neutral"}>
      {installed ? (
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <CheckCircle2 size={16} className="text-battery" />
          Installed — running as an app
        </div>
      ) : canInstall ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Install for a full-screen, app-like experience — no browser bar, launches from your home screen.
          </p>
          <button
            onClick={promptInstall}
            className="rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95"
          >
            Install Bongo Control
          </button>
        </div>
      ) : isIOS ? (
        <p className="text-sm text-text-secondary">
          Tap the <span className="text-text-primary">Share</span> icon in Safari's toolbar, then{" "}
          <span className="text-text-primary">Add to Home Screen</span>. iOS doesn't support one-tap install from the page
          itself.
        </p>
      ) : (
        <p className="text-sm text-text-secondary">
          Look for an install icon in your browser's address bar, or use its menu → "Install Bongo Control" / "Add to Home
          Screen".
        </p>
      )}
    </Card>
  );
}
