import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getCategoryLabel,
  getSeasonLabel,
  getStatusLabel,
} from "@/lib/clothing-options";
import { getWearRecencyLabel } from "@/lib/wear-logs";
import Image from "next/image";

type ClothingItemCardProps = {
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  favorite: boolean;
  status: string;
  lastWornAt: string | null;
  imageUrl: string | null;
};

export function ClothingItemCard({
  title,
  brand,
  category,
  season,
  favorite,
  status,
  lastWornAt,
  imageUrl,
}: ClothingItemCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            画像なし
          </div>
        )}
      </div>
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
        <Badge variant="outline">{getStatusLabel(status)}</Badge>
        <Badge variant="secondary">{getWearRecencyLabel(lastWornAt)}</Badge>
      </CardContent>
    </Card>
  );
}
