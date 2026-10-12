import { ScrollToHashTarget } from "@/components/scroll-to-hash-target";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ReviewSuggestion } from "@/lib/review-suggestions";
import Image from "next/image";
import Link from "next/link";

// Closet一覧の上部に出す「今日見直す3着」。写真・タイトルは服の詳細へ、
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
      className="flex scroll-mt-4 flex-col gap-3 rounded-xl border bg-muted/30 p-4"
    >
      {/* Todayの「今日の3着を見る」（/protected/items#review-suggestions-title）から
          来た場合、このカードは後から表示されるため、表示時にカードの先頭へ移動する */}
      <ScrollToHashTarget
        targetId="review-suggestions-title"
        scrollTo="review-suggestions"
      />
      <div className="flex flex-col gap-1">
        <h2 id="review-suggestions-title" className="text-base font-semibold">
          今日見直す3着
        </h2>
        <p className="text-xs text-muted-foreground">
          着る・残す・手放すを考えるきっかけに。すぐに決めなくて大丈夫です
        </p>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
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
        <ul className="flex flex-col gap-2">
          {suggestions.map(({ item, reason, inSeason }) => {
            const imageUrl = imageUrls.get(item.id);
            return (
              <li key={item.id}>
                <Card className="flex items-center gap-3 p-2.5">
                  <Link
                    href={`/protected/items/${item.id}`}
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted"
                    aria-label={`${item.title}の詳細を見る`}
                  >
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt=""
                        fill
                        sizes="64px"
                        className="object-contain"
                        style={{ objectFit: "contain" }}
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                        写真なし
                      </span>
                    )}
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link
                      href={`/protected/items/${item.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {reason}
                    </p>
                    {inSeason && (
                      <p className="text-[11px] text-muted-foreground">
                        今の季節に着られる服です
                      </p>
                    )}
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link href={`/protected/items/${item.id}/diagnosis`}>
                      見直す
                    </Link>
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* 1着ずつスワイプで見直す（最大10着） */}
      {totalItemCount > 0 && (
        <Link
          href="/protected/review"
          className="w-fit text-sm font-medium underline underline-offset-4 hover:text-foreground"
        >
          まとめて見直す（最大10着）→
        </Link>
      )}
    </section>
  );
}
