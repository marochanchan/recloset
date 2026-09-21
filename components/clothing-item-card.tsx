import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";

type ClothingItemCardProps = {
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  favorite: boolean;
  status: string;
};

export function ClothingItemCard({
  title,
  brand,
  category,
  season,
  favorite,
  status,
}: ClothingItemCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          {favorite && <Badge>お気に入り</Badge>}
        </div>
        {brand && <p className="text-sm text-muted-foreground">{brand}</p>}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Badge variant="secondary">{getCategoryLabel(category)}</Badge>
        {season && (
          <Badge variant="secondary">{getSeasonLabel(season)}</Badge>
        )}
        <Badge variant="outline">{status}</Badge>
      </CardContent>
    </Card>
  );
}
