// ブランド入力の候補（自分がすでに登録したブランド）を集める純粋関数。
// 前後の空白を取り、大文字・小文字を区別せずまとめ、よく使う順（同じ数なら名前順）に並べる

export const MAX_BRAND_SUGGESTIONS = 30;

export function buildBrandSuggestions(
  brands: ReadonlyArray<string | null | undefined>,
  limit = MAX_BRAND_SUGGESTIONS,
): string[] {
  // 比べる用のキー（小文字）→ 数と、表記ごとの数
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const raw of brands) {
    const brand = raw?.trim();
    if (!brand) continue;
    const key = brand.toLowerCase();
    const group = groups.get(key) ?? { count: 0, spellings: new Map() };
    group.count++;
    group.spellings.set(brand, (group.spellings.get(brand) ?? 0) + 1);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      // 表記ゆれは、いちばん多い表記（同数なら名前順で先）を代表にする
      const spelling = [...group.spellings.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      )[0][0];
      return { key, spelling, count: group.count };
    })
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, limit)
    .map((entry) => entry.spelling);
}
