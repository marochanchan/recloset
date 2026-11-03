// 画面ごとの「戻る」リンクの決め方。UUID でない値は無視する。

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BackLink = { href: string; label: string };

/** searchParams の値が UUID の文字列ならそのまま、それ以外は null */
export function parseUuidParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/** 記録の画面：?item= があればその服の詳細へ、なければ着画の一覧へ */
export function newLookBackLink(itemId: string | null): BackLink {
  return itemId
    ? { href: `/protected/items/${itemId}`, label: "服へ戻る" }
    : { href: "/protected/looks", label: "着画" };
}

/** 服の詳細：?from= の着画があればそこへ、なければクローゼットへ */
export function itemBackLink(fromLookId: string | null): BackLink {
  return fromLookId
    ? { href: `/protected/looks/${fromLookId}`, label: "着画" }
    : { href: "/protected/items", label: "クローゼット" };
}
