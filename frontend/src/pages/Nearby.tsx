import { MapPin } from "lucide-react";
import Card from "../components/Cards/Card";
import NearbyMap from "../components/Map/NearbyMap";
import AiRecommendationsCard from "../components/Nearby/AiRecommendationsCard";

export default function Nearby() {
  return (
    <div className="space-y-5">
      <Card label="Nearby" icon={<MapPin size={14} />}>
        <NearbyMap />
      </Card>
      <AiRecommendationsCard />
    </div>
  );
}
