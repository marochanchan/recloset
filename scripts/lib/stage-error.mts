// スクリプトの失敗を画面に出す形に直す helper。
// 外部の文言（Cloudflare のエラー文、鍵の解析のメッセージ、秘密の入った URL）は出さない。
// 出すのは「段階の名前」と、HTTP の状態・Cloudflare のエラー番号・例外の種類だけ。

// このスクリプト自身が書いたメッセージ（秘密を含まないと分かっているもの）を運ぶ例外
export class StageFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageFailure";
  }
}

export function formatStageError(stage: string, error: unknown): string {
  if (error instanceof StageFailure) return `${stage}：${error.message}`;
  if (typeof error === "object" && error !== null) {
    const { status, codes } = error as { status?: unknown; codes?: unknown };
    if (typeof status === "number" && Array.isArray(codes)) {
      const numbers = codes.filter((code): code is number => typeof code === "number");
      return `${stage}：Cloudflare への呼び出しに失敗しました（HTTP ${status}、エラー番号 ${numbers.length > 0 ? numbers.join(",") : "なし"}）`;
    }
  }
  // 種類の名前だけ。名前が普通の英字でなければ Error にする
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "Error";
  return `${stage}：失敗しました（${name}）`;
}
