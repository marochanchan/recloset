// 公開名（profiles.display_name）の検証。
// Server Action（保存・公開前チェック）とクライアントのフォームで共通に使う。
// DB側にも同じ条件のCHECK制約（migration 009: profiles_display_name_format）が
// あり、そちらが最終防衛線になる。

export const DISPLAY_NAME_MAX_LENGTH = 20;

// 制御文字（改行・タブ等）。DBの [[:cntrl:]] に対応する
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

export type DisplayNameValidationResult =
  | { value: string; error: null }
  | { value: null; error: string };

/**
 * 入力値の前後の空白（全角スペースを含む）を取り除いてから検証する。
 * 文字数はDBのchar_lengthに合わせ、UTF-16の単位ではなく文字（コードポイント）で数える。
 */
export function validateDisplayName(input: string): DisplayNameValidationResult {
  const value = input.trim();
  const length = Array.from(value).length;

  if (length === 0) {
    return { value: null, error: "公開名を入力してください" };
  }
  if (length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      value: null,
      error: `公開名は${DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください`,
    };
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return {
      value: null,
      error: "公開名に改行やタブなどは使えません",
    };
  }
  return { value, error: null };
}

/**
 * DBから取得した公開名が、公開に使える状態か（設定済みで、形式が正しいか）。
 * 前後の空白がある値は、DBのCHECK制約上ありえないが念のため不可とする。
 */
export function isUsableDisplayName(
  displayName: string | null | undefined,
): displayName is string {
  if (typeof displayName !== "string") return false;
  const result = validateDisplayName(displayName);
  return result.error === null && result.value === displayName;
}

const ITEM_DETAIL_PATH_PATTERN =
  /^\/protected\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 公開名設定ページの「戻り先」として許可するパスだけを返す。
 * open redirectを防ぐため、自分の服の詳細ページ（/protected/items/{uuid}）の
 * 完全一致だけを許可し、それ以外（外部URL・//から始まるパス等）はnullにする。
 */
export function getSafeReturnTo(
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== "string") return null;
  return ITEM_DETAIL_PATH_PATTERN.test(value) ? value : null;
}
