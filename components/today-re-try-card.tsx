import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";

type TodayReTryCardProps = {
  itemId: string;
  title: string;
  brand: string | null;
  wearRecencyLabel: string;
  imageUrl: string | null;
};

export function TodayReTryCard({
  itemId,
  title,
  brand,
  wearRecencyLabel,
  imageUrl,
}: TodayReTryCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className="relative aspect-square w-full sm:w-40 shrink-0 bg-muted">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title}
              fill
              sizes="(min-width: 640px) 160px, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
              画像なし
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 p-4 flex-1">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            {brand && (
              <p className="text-sm text-muted-foreground">{brand}</p>
            )}
          </div>
          <Badge variant="secondary" className="w-fit">
            {wearRecencyLabel}
          </Badge>
          <Button asChild size="sm" className="w-fit mt-auto">
            <Link href={`/protected/items/${itemId}`}>この服を見る</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
