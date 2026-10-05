"use client";

import { updateDisplayName } from "@/app/protected/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPLAY_NAME_MAX_LENGTH, validateDisplayName } from "@/lib/display-name";
import Link from "next/link";
import { useState, useTransition } from "react";

type DisplayNameFormProps = {
  initialDisplayName: string | null;
  /** 検証済みの戻り先（自分の服の詳細ページ）。なければnull */
  returnTo: string | null;
};

export function DisplayNameForm({
  initialDisplayName,
  returnTo,
}: DisplayNameFormProps) {
  const [value, setValue] = useState(initialDisplayName ?? "");
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;
    setError(null);
    setSavedName(null);

    // サーバーでも同じ検証を行う。ここでは送信前に分かる誤りだけを先に伝える
    const validated = validateDisplayName(value);
    if (validated.error !== null) {
      setError(validated.error);
      return;
    }

    startTransition(async () => {
      const result = await updateDisplayName(validated.value);
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      setValue(result.displayName);
      setSavedName(result.displayName);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="display-name">公開名（ニックネーム）</Label>
        <Input
          id="display-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          placeholder="例：りくろう"
          autoComplete="nickname"
          disabled={isPending}
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "保存中..." : "保存する"}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {savedName && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">公開名を「{savedName}」に保存しました。</p>
          {returnTo && (
            <Link
              href={returnTo}
              className="text-sm underline underline-offset-4 w-fit"
            >
              服の詳細に戻って公開する
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
