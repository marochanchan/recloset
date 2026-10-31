// 撮影開始の合図。今は PC のボタンだけ。あとから声やジェスチャーを足せるよう、購読の形にしておく。

export type CaptureTrigger = { subscribe(fire: () => void): () => void };

export function createManualTrigger(): CaptureTrigger & { fire(): void } {
  const listeners = new Set<() => void>();
  return {
    subscribe(fire) {
      listeners.add(fire);
      return () => {
        listeners.delete(fire);
      };
    },
    fire() {
      // 呼び出し中に解除されても安全なよう、コピーしてから回す
      for (const listener of [...listeners]) listener();
    },
  };
}
