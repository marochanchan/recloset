// 時間のかかる処理（コマの切り出しなど）の結果を、まだ使ってよいか見分ける世代（純粋）。
// 画面が隠れた・撮り直したときに bump して、古い処理の結果を捨てる。
export function createGeneration() {
  let value = 0;
  return {
    current: () => value,
    bump: () => ++value,
    isCurrent: (g: number) => g === value,
  };
}
