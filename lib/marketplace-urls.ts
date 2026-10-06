// ============================================================
// 外部フリマサービスの出品URL（clothing_items.mercari_url等）
//
// ユーザーが手動で貼り付けたURLを、対応サービスの商品ページURLだけに
// 制限する。許可範囲は実際の出品URLで確認できた形式だけで、
// 短縮URL・共有用の別ドメイン・アプリ用URL等は許可しない。
//
// 同じ制約をmigration 010のCHECK制約でもDB側で強制している
// （フォームはブラウザから直接clothing_itemsへ書き込むため、
// このファイルの検証だけでは不正な値の保存を防げない）。
// 変更する場合は両方を揃えること。
// ============================================================

export const MARKETPLACE_URL_MAX_LENGTH = 500;

export type MarketplaceService = "mercari" | "rakuma" | "yahooFurima";

type MarketplaceDefinition = {
  label: string;
  /** hostnameは完全一致で判定する（endsWithは使わない） */
  hostname: string;
  /** 商品ページのpath（末尾スラッシュ除去後）。クエリ・ハッシュは保存しない */
  pathPattern: RegExp;
  example: string;
};

// 表示順もこの順にする
export const MARKETPLACE_SERVICES: MarketplaceService[] = [
  "mercari",
  "rakuma",
  "yahooFurima",
];

export const MARKETPLACES: Record<MarketplaceService, MarketplaceDefinition> =
  {
    mercari: {
      label: "メルカリ",
      hostname: "jp.mercari.com",
      pathPattern: /^\/item\/[A-Za-z0-9]+$/,
      example: "https://jp.mercari.com/item/...",
    },
    rakuma: {
      label: "ラクマ",
      hostname: "item.fril.jp",
      pathPattern: /^\/[0-9a-f]{32}$/,
      example: "https://item.fril.jp/...",
    },
    yahooFurima: {
      label: "Yahoo!フリマ",
      hostname: "paypayfleamarket.yahoo.co.jp",
      pathPattern: /^\/item\/[A-Za-z0-9]+$/,
      example: "https://paypayfleamarket.yahoo.co.jp/item/...",
    },
  };

export type MarketplaceUrlValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * 出品URLを検証し、保存用の正規化済みURL（https://{hostname}{path}）を返す。
 * - 前後の空白を除去し、空文字はnull（未登録）として扱う
 * - httpsのみ、username/password/port付きは不可
 * - hostnameはサービスごとの値と完全一致
 * - 商品ページのpathのみ（クエリ・ハッシュは取り除いて保存する）
 */
export function validateMarketplaceUrl(
  service: MarketplaceService,
  input: string | null | undefined,
): MarketplaceUrlValidationResult {
  const value = (input ?? "").trim();
  if (value === "") {
    return { ok: true, value: null };
  }

  const { label, hostname, pathPattern, example } = MARKETPLACES[service];
  const error = `${label}の商品URLを入力してください（${example}）`;

  if (value.length > MARKETPLACE_URL_MAX_LENGTH) {
    return { ok: false, error };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error };
  }

  const path = url.pathname.replace(/\/$/, "");

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hostname !== hostname ||
    !pathPattern.test(path)
  ) {
    return { ok: false, error };
  }

  return { ok: true, value: `https://${hostname}${path}` };
}

export type MarketplaceUrls = Record<MarketplaceService, string | null>;

export type MarketplaceLink = {
  service: MarketplaceService;
  label: string;
  href: string;
};

/**
 * 表示用に、検証を通ったURLだけをリンク情報として返す。
 * DB制約で守られているが、万一不正な値が入っていてもリンクにしない。
 */
export function getMarketplaceLinks(urls: MarketplaceUrls): MarketplaceLink[] {
  return MARKETPLACE_SERVICES.flatMap((service) => {
    const result = validateMarketplaceUrl(service, urls[service]);
    if (!result.ok || result.value === null) {
      return [];
    }
    return [
      { service, label: MARKETPLACES[service].label, href: result.value },
    ];
  });
}
