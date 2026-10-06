// ログイン後の戻り先（/auth/login?next=...）として許可するパス。
// open redirectを防ぐため、外部URL・プロトコル相対URL（//evil.example）
// を含め、Re:Closet Loopの公開詳細（/discover/{uuid}）以外はすべて拒否する。

const DISCOVER_ITEM_PATH_PATTERN =
  /^\/discover\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getSafeLoginRedirect(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  return DISCOVER_ITEM_PATH_PATTERN.test(value) ? value : null;
}

export function buildLoginHrefForDiscoverItem(itemId: string): string {
  return `/auth/login?next=${encodeURIComponent(`/discover/${itemId}`)}`;
}
