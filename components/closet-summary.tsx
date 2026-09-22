import { Card, CardContent } from "@/components/ui/card";

type ClosetSummaryProps = {
  totalCount: number;
  favoriteCount: number;
  candidateCount: number;
};

export function ClosetSummary({
  totalCount,
  favoriteCount,
  candidateCount,
}: ClosetSummaryProps) {
  const summaryItems = [
    { label: "登録している服", value: totalCount },
    { label: "お気に入り", value: favoriteCount },
    { label: "手放し候補", value: candidateCount },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {summaryItems.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex flex-col items-center gap-1 pt-6 text-center">
            <span className="text-2xl font-bold">{item.value}</span>
            <span className="text-xs text-muted-foreground sm:text-sm">
              {item.label}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
