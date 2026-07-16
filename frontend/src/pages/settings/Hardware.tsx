import { Cpu } from "lucide-react";
import Card from "../../components/Cards/Card";

export default function Hardware() {
  return (
    <Card label="Hardware" icon={<Cpu size={14} />}>
      <p className="text-sm text-text-muted">
        Once real hardware plugins exist (Victron Bluetooth, battery shunt, GPS), their connection settings — pairing,
        device selection, polling interval — will live here. No hardware is connected yet, so there's nothing to
        configure: this section is navigation only for now.
      </p>
    </Card>
  );
}
