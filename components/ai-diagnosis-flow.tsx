"use client";

import {
  generateDiagnosisElaboration,
  runAiDiagnosis,
  updateClothingItemStatus,
} from "@/app/(main)/protected/items/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CURRENT_FEELING_OPTIONS,
  NOT_WORN_REASON_OPTIONS,
  WANT_TO_WEAR_AGAIN_OPTIONS,
  type CurrentFeeling,
  type JevDiagnosisResult,
  type NotWornReason,
  type WantToWearAgain,
} from "@/lib/ai-diagnosis";
import { getStatusLabel } from "@/lib/clothing-options";
import { DIAGNOSIS_TYPE_LABELS } from "@/lib/decision-hints";
import type { NextAction } from "@/lib/next-action";
import { Check, Sprout } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

type AiDiagnosisFlowProps = {
  itemId: string;
  title: string;
  brand: string | null;
  categoryLabel: string;
  seasonLabel: string | null;
  favorite: boolean;
  currentStatus: string;
};

const CANDIDATE_STATUS = "candidate";

/**
 * REBYE診断時だけ表示する、statusを「手放し候補」に変更するための
 * 控えめな提案UI。AIが自動でstatusを書き換えることはなく、
 * ボタンを押したときだけ既存のupdateClothingItemStatusを呼ぶ。
 */
function RebyeCandidateAction({
  itemId,
  initialStatus,
}: {
  itemId: string;
  initialStatus: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const candidateLabel = getStatusLabel(CANDIDATE_STATUS);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateClothingItemStatus(
        itemId,
        CANDIDATE_STATUS,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setJustUpdated(true);
    });
  };

  if (justUpdated) {
    return (
      <p className="text-sm text-muted-foreground">
        ステータスを「{candidateLabel}」に変更しました
      </p>
    );
  }

  if (initialStatus === CANDIDATE_STATUS) {
    return (
      <p className="text-sm text-muted-foreground">
        現在「{candidateLabel}」に設定されています
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        この服を「{candidateLabel}」に変更しますか？
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={isPending}
        onClick={handleClick}
      >
        {isPending ? "変更中..." : `${candidateLabel}に変更する`}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

type DiagnosisResultState = {
  decision: JevDiagnosisResult;
  decisionHints: string[];
  nextAction: NextAction;
  /** ai_diagnoses履歴の行id。履歴保存に失敗した場合はnull。 */
  diagnosisId: string | null;
};

/**
 * 「この服との関係を言葉にしてみる」ボタン。ユーザーが明示的に押した場合だけ
 * generateDiagnosisElaboration（Gemini）を1回呼ぶ。次の一歩（行動）とは別に、
 * その服との今の関係を見る角度を変える言葉を表示する。成功後は生成結果を
 * そのまま表示し、再生成はできない（サーバー側でも1診断1回に制限している）。
 * 失敗時はJevの診断結果に影響しない旨のメッセージを表示し、再試行は許可する。
 */
function ElaborationAction({ diagnosisId }: { diagnosisId: string }) {
  const [isPending, startTransition] = useTransition();
  const [elaboration, setElaboration] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateDiagnosisElaboration(diagnosisId);
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      setElaboration(result.elaboration);
    });
  };

  // 見出しは外側のブロック（「もう少し考えたいときは」）が担うため、本文だけを出す
  if (elaboration) {
    return (
      <p className="whitespace-pre-line text-sm leading-relaxed">
        {elaboration}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={isPending}
        onClick={handleClick}
      >
        {isPending
          ? "言葉にしています..."
          : error
            ? "再試行"
            : "この服との関係を言葉にしてみる"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

const MAX_NOT_WORN_REASONS = 2;

function OptionButtons<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? "default" : "outline"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Q3専用の複数選択ボタン群。
 * - 通常の理由は最大2つまで
 * - "do_not_remember" は排他的（選ぶと他をすべて解除、他を選ぶとdo_not_rememberを解除）
 */
function NotWornReasonButtons({
  options,
  value,
  onChange,
}: {
  options: readonly { value: NotWornReason; label: string }[];
  value: NotWornReason[];
  onChange: (value: NotWornReason[]) => void;
}) {
  const handleToggle = (option: NotWornReason) => {
    if (value.includes(option)) {
      onChange(value.filter((selected) => selected !== option));
      return;
    }

    if (option === "do_not_remember") {
      onChange(["do_not_remember"]);
      return;
    }

    const withoutDoNotRemember = value.filter(
      (selected) => selected !== "do_not_remember",
    );
    if (withoutDoNotRemember.length >= MAX_NOT_WORN_REASONS) {
      return; // 既に上限まで選択済み
    }

    onChange([...withoutDoNotRemember, option]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = value.includes(option.value);
        const isAtLimit =
          !isSelected &&
          option.value !== "do_not_remember" &&
          value.filter((selected) => selected !== "do_not_remember")
            .length >= MAX_NOT_WORN_REASONS;

        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={isSelected ? "default" : "outline"}
            disabled={isAtLimit}
            onClick={() => handleToggle(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

// 主ボタン・副ボタン共通。スマホでも押しやすい高さにし、文言が長くても折り返す
const NEXT_LINK_BUTTON_CLASS =
  "h-auto min-h-11 w-full whitespace-normal py-2 text-center";

/**
 * 診断後の導線（既存画面へのリンクだけ）。
 * diagnosisIdがある＝ai_diagnosesへの保存に成功した場合だけ、Re:Questへの記録を案内する
 * （Re:Questの「見直し」はai_diagnosesを直接数えるため、保存できていれば必ず反映される）。
 * Re:Gardenは活動記録（トリガー）経由かつ1日1ptのため、記録されたとは断定せず仕組みだけを伝える
 */
function DiagnosisNextLinks({
  itemId,
  recorded,
}: {
  itemId: string;
  recorded: boolean;
}) {
  return (
    <section aria-labelledby="diagnosis-next-title" className="flex flex-col gap-3">
      <h2 id="diagnosis-next-title" className="text-base font-semibold">
        次にできること
      </h2>
      {recorded && (
        <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <Sprout className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            今回の見直しは、今日のRe:Questに記録されました。Re:Gardenも、見直しをした日ごとに育ちます。
          </span>
        </p>
      )}
      <Button asChild className={NEXT_LINK_BUTTON_CLASS}>
        <Link href={`/protected/items/${itemId}`}>服の詳細へ</Link>
      </Button>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild variant="outline" className={NEXT_LINK_BUTTON_CLASS}>
          <Link href="/protected/items#review-suggestions-title">次の1着を見直す</Link>
        </Button>
        <Button asChild variant="outline" className={NEXT_LINK_BUTTON_CLASS}>
          <Link href="/today">Todayで今日の記録を見る</Link>
        </Button>
      </div>
    </section>
  );
}

export function AiDiagnosisFlow({
  itemId,
  title,
  brand,
  categoryLabel,
  seasonLabel,
  favorite,
  currentStatus,
}: AiDiagnosisFlowProps) {
  const [currentFeeling, setCurrentFeeling] = useState<CurrentFeeling | null>(
    null,
  );
  const [wantToWearAgain, setWantToWearAgain] =
    useState<WantToWearAgain | null>(null);
  const [notWornReasons, setNotWornReasons] = useState<NotWornReason[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosisResultState | null>(null);

  const canSubmit =
    currentFeeling !== null &&
    wantToWearAgain !== null &&
    notWornReasons.length > 0;

  const handleSubmit = () => {
    if (!currentFeeling || !wantToWearAgain || notWornReasons.length === 0)
      return;
    setError(null);
    startTransition(async () => {
      const response = await runAiDiagnosis(itemId, {
        currentFeeling,
        wantToWearAgain,
        notWornReasons,
      });
      if (response.error !== null) {
        setError(response.error);
        return;
      }
      setResult({
        decision: response.decision,
        decisionHints: response.decisionHints,
        nextAction: response.nextAction,
        diagnosisId: response.diagnosisId,
      });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-xl">{title}</CardTitle>
            {favorite && <Badge>お気に入り</Badge>}
          </div>
          {brand && <p className="text-sm text-muted-foreground">{brand}</p>}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="secondary">{categoryLabel}</Badge>
          {seasonLabel && <Badge variant="secondary">{seasonLabel}</Badge>}
        </CardContent>
      </Card>

      {!result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3つの質問</CardTitle>
            <CardDescription>
              これは判定ではなく、あなたが考えるためのヒントを見つける質問です。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                今、この服をどれくらい気に入っていますか？
              </p>
              <OptionButtons
                options={CURRENT_FEELING_OPTIONS}
                value={currentFeeling}
                onChange={setCurrentFeeling}
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                もう一度、この服を着たいと思いますか？
              </p>
              <OptionButtons
                options={WANT_TO_WEAR_AGAIN_OPTIONS}
                value={wantToWearAgain}
                onChange={setWantToWearAgain}
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                この服を着る機会や、着るときに気になることは？（最大2つ）
              </p>
              <NotWornReasonButtons
                options={NOT_WORN_REASON_OPTIONS}
                value={notWornReasons}
                onChange={setNotWornReasons}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || isPending}
            >
              {isPending ? "考えています..." : "提案を見る"}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今回の提案</CardTitle>
            <CardDescription>
              これは手放す・残すを決める答えではなく、あなたが考えるためのヒントです。最終的に決めるのはあなたです。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* 提案（日本語）を主役に、診断タイプ（英語）は小さく添える */}
            <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-4">
              <Badge variant="outline" className="bg-background">
                {DIAGNOSIS_TYPE_LABELS[result.decision.choice].badge}
              </Badge>
              <p className="text-2xl font-bold leading-snug">
                {DIAGNOSIS_TYPE_LABELS[result.decision.choice].caption}
              </p>
            </div>

            {/* 着用記録とあなたの回答のうち、今回の診断に関係が深いものを
                ルールベースで選んで表示する（lib/decision-hints.ts） */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">この提案につながったこと</p>
                <p className="text-xs text-muted-foreground">
                  あなたの回答と、Re:Closetでの着用記録の有無をもとに考えました。
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {result.decisionHints.map((hint) => (
                  <li key={hint} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <span className="break-words">{hint}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2 rounded-md border p-4">
              <p className="text-sm font-medium">次の一歩</p>
              <p className="font-medium">{result.nextAction.title}</p>
              <p className="text-sm text-muted-foreground">
                {result.nextAction.message}
              </p>

              {result.decision.choice === "REBYE" && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <RebyeCandidateAction
                    itemId={itemId}
                    initialStatus={currentStatus}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Geminiは独立したブロック。押したときだけ、1診断1回まで（履歴の保存に成功したときだけ出す） */}
      {result?.diagnosisId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">もう少し考えたいときは</CardTitle>
            <CardDescription>AIが、考えるための問いを1つ返します</CardDescription>
          </CardHeader>
          <CardContent>
            <ElaborationAction diagnosisId={result.diagnosisId} />
          </CardContent>
        </Card>
      )}

      {result && (
        <DiagnosisNextLinks itemId={itemId} recorded={result.diagnosisId !== null} />
      )}
    </div>
  );
}
