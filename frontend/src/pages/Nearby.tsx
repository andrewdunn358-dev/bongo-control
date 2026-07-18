import { MapPin } from "lucide-react";
import Card from "../components/Cards/Card";
import NearbyMap from "../components/Map/NearbyMap";

export default function Nearby() {
  return (
    <Card label="Nearby" icon={<MapPin size={14} />}>
      <NearbyMap />
    </Card>
  );
}
