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

  // カードで囲まず、上下の線と区切り線だけで3つの数字を並べる
  return (
    <div className="grid grid-cols-3 divide-x divide-border border-y border-border">
      {summaryItems.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-label={`${item.label} ${item.value}件をクローゼットで見る`}
          className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 px-2 py-4 text-center outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent"
        >
          <span className="text-2xl font-semibold tabular-nums">{item.value}</span>
          <span className="text-xs text-muted-foreground sm:text-sm">
            {item.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
