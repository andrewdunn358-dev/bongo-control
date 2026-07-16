import Card from "../../components/Cards/Card";
import Timeline from "../../components/Timeline/Timeline";
import { useTelemetry } from "../../context/TelemetryContext";

export default function Notifications() {
  const { notifications } = useTelemetry();

  const items = notifications.map((n) => ({
    id: n.id,
    timestamp: n.message.timestamp,
    text: `${n.message.payload.title} — ${n.message.payload.message}`,
  }));

  return (
    <Card label="Notification History">
      <Timeline items={items} emptyMessage="No notifications yet — battery alerts and plugin events will appear here." />
    </Card>
  );
}
