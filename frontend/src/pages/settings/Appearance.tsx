import { Palette } from "lucide-react";
import Card from "../../components/Cards/Card";

export default function Appearance() {
  return (
    <Card label="Appearance" icon={<Palette size={14} />}>
      <p className="text-sm text-text-muted">
        Theme and display customization (light mode, accent color, density) will live here in a future milestone. This
        section exists now so the navigation structure is in place ahead of that work.
      </p>
    </Card>
  );
}
