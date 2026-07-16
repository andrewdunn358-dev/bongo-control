import { ListTree } from "lucide-react";
import Card from "./Card";
import Timeline from "../Timeline/Timeline";
import { useTelemetry } from "../../context/TelemetryContext";
import { useRecentEvents } from "../../hooks/useRecentEvents";

export default function RecentEventsCard({ index = 0 }: { index?: number }) {
  const { state } = useTelemetry();
  const events = useRecentEvents(state);

  return (
    <Card label="Recent Events" icon={<ListTree size={14} />} index={index}>
      <Timeline items={events} emptyMessage="No events yet — this fills in as things change." />
    </Card>
  );
}
