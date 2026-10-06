import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

// Re:Closetの基本体験（登録 → 記録 → 整理 → 次へ）を4ステップで説明する。
// 未ログインのトップと、ログイン中で服が0件のトップで使う。
// ページ側のレイアウトに依存しないよう、幅の上限等はclassNameで渡す。

const STEPS = [
  {
    title: "クローゼットに登録",
    description: "手持ちの服を、写真と一緒に。",
  },
  {
    title: "着た日を記録",
    description: "「最近着てる？」を、感覚ではなく記録で。",
  },
  {
    title: "AIと一緒に整理",
    description:
      "着用記録と今の気持ちから、残す・もう一度着る・手放すを考える。",
  },
  {
    title: "次のクローゼットへ",
    description: "Re:Closet Loopで公開したり、フリマの出品につないだり。",
  },
] as const;

type OnboardingStepsProps = {
  /** ログイン中・服0件のときtrue。「最初の服を登録する」と補足を表示する */
  showRegisterCta?: boolean;
  className?: string;
};

export function OnboardingSteps({
  showRegisterCta = false,
  className,
}: OnboardingStepsProps) {
  return (
    <section
      aria-labelledby="onboarding-steps-title"
      className={cn(
        "flex w-full flex-col gap-5 rounded-xl border bg-card p-5 text-left sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id="onboarding-steps-title" className="text-lg font-semibold">
          Re:Closetのはじめかた
        </h2>
        <p className="text-sm text-muted-foreground">
          服との関係を見直して、着る・残す・手放すを考える4ステップ。
        </p>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {showRegisterCta && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <Button asChild className="w-full sm:w-fit">
            <Link href="/protected/items/new">最初の服を登録する</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            着用記録・AI診断・Loopへの公開は、服を登録したあとの詳細ページから行えます。
          </p>
        </div>
      )}
    </section>
  );
}
