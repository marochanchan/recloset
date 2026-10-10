import { Card, CardContent } from "@/components/ui/card";
import { CLOSET_FILTER_PATH } from "@/lib/closet-filters";
import Link from "next/link";

type ClosetSummaryProps = {
  totalCount: number;
  favoriteCount: number;
  candidateCount: number;
};

// 件数はそれぞれ、同じ条件で絞り込んだクローゼット一覧へのリンクにする
// （絞り込みの仕様は lib/closet-filters.ts）
export function ClosetSummary({
  totalCount,
  favoriteCount,
  candidateCount,
}: ClosetSummaryProps) {
  const summaryItems = [
    { label: "登録している服", value: totalCount, href: CLOSET_FILTER_PATH },
    {
      label: "お気に入り",
      value: favoriteCount,
      href: `${CLOSET_FILTER_PATH}?favorite=1`,
    },
    {
      label: "手放し候補",
      value: candidateCount,
      href: `${CLOSET_FILTER_PATH}?status=candidate`,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {summaryItems.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-label={`${item.label} ${item.value}件をクローゼットで見る`}
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full transition-colors hover:bg-accent active:bg-accent">
            <CardContent className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 p-3 text-center sm:p-4">
              <span className="text-2xl font-bold">{item.value}</span>
              <span className="text-xs text-muted-foreground sm:text-sm">
                {item.label}
              </span>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
