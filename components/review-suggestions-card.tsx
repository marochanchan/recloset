import { ScrollToHashTarget } from "@/components/scroll-to-hash-target";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PHOTO_ONLY_DISPLAY_LABEL,
  PHOTO_ONLY_TITLE,
} from "@/lib/clothing-options";
import type { ReviewSuggestion } from "@/lib/review-suggestions";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";

// Closet一覧の上部に出す「今日見直す3着」（写真が主役の小さなカード）。写真・タイトルは服の詳細へ、
// 「見直す」は既存のAI診断画面へ移動する（ここではAPIを呼ばない）
export function ReviewSuggestionsCard({
  suggestions,
  imageUrls,
  totalItemCount,
}: {
  suggestions: ReviewSuggestion[];
  /** 服ID → 代表画像の署名付きURL */
  imageUrls: Map<string, string>;
  /** 登録している服の数（候補0着のときの案内の出し分けに使う） */
  totalItemCount: number;
}) {
  return (
    <section
      id="review-suggestions"
      aria-labelledby="review-suggestions-title"
      className="flex scroll-mt-4 flex-col gap-3"
    >
      {/* Todayの「今日の3着を見る」（/protected/items#review-suggestions-title）から
          来た場合、このカードは後から表示されるため、表示時にカードの先頭へ移動する */}
      <ScrollToHashTarget
        targetId="review-suggestions-title"
        scrollTo="review-suggestions"
      />
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="review-suggestions-title" className="text-base font-bold">
            今日見直す3着
          </h2>
          <p className="text-xs text-muted-foreground">
            着る・残す・手放す、1着ずつ一緒に考えます
          </p>
        </div>
        {/* 横スクロールになるスマホだけ、続きがあることを文字でも示す */}
        {suggestions.length > 2 && (
          <p className="shrink-0 text-xs text-muted-foreground sm:hidden">
            スワイプで{suggestions.length}着 →
          </p>
        )}
      </div>

      {suggestions.length === 0 ? (
        <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          {totalItemCount === 0 ? (
            <>
              まだ服が登録されていません。
              <Link
                href="/protected/items/new"
                className="underline underline-offset-4 hover:text-foreground"
              >
                まずは1着から登録してみましょう
              </Link>
            </>
          ) : (
            "今は見直し候補がありません。また時間をおいて確認してみてください。"
          )}
        </p>
      ) : (
        // スマホは画面の端まで横スクロール（3着目の端が見える幅）、広い画面は3列
        <ul className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {suggestions.map(({ item, reason, inSeason }) => {
            const imageUrl = imageUrls.get(item.id);
            const isPhotoOnly = item.title === PHOTO_ONLY_TITLE;
            return (
              <li
                key={item.id}
                className="w-[36%] min-w-[7.5rem] shrink-0 snap-start sm:w-auto sm:min-w-0"
              >
                <div className="flex h-full flex-col gap-2">
                  <Link
                    href={`/protected/items/${item.id}`}
                    className="relative block aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-photo outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`${item.title}の詳細を見る`}
                  >
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt=""
                        fill
                        sizes="(min-width: 640px) 240px, 45vw"
                        className="object-contain"
                        style={{ objectFit: "contain" }}
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        写真なし
                      </span>
                    )}
                    {inSeason && (
                      <Badge
                        variant="outline"
                        className="absolute left-1.5 top-1.5 border-transparent bg-card/90 px-2 text-[11px] font-normal"
                      >
                        今の季節
                      </Badge>
                    )}
                  </Link>
                  <div className="flex flex-1 flex-col gap-2 px-0.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Link
                        href={`/protected/items/${item.id}`}
                        className={cn(
                          "line-clamp-2 break-words text-sm leading-snug hover:underline",
                          isPhotoOnly
                            ? "text-muted-foreground"
                            : "font-medium",
                        )}
                      >
                        {isPhotoOnly ? PHOTO_ONLY_DISPLAY_LABEL : item.title}
                      </Link>
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {reason}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="mt-auto w-full">
                      <Link href={`/protected/items/${item.id}/diagnosis`}>
                        見直す
                      </Link>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 「まとめて見直す」はページ上部の主要な操作として置いている */}
    </section>
  );
}
