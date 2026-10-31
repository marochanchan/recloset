// カウントダウンの音。音が出なくても撮影には影響させない（すべて try/catch で包む）。
// AudioContext は prepare / beep の中で初めて触る（サーバーでの描画時に触らないため）。

export function createCountdownBeep(): {
  prepare(): void;
  beep(secondsLeft: number): void;
  dispose(): void;
} {
  let context: AudioContext | null = null;

  return {
    prepare() {
      try {
        // 撮影ボタンを押したときに作る（ブラウザが音を許す）
        if (!context || context.state === "closed") context = new AudioContext();
        if (context.state === "suspended") void context.resume().catch(() => {});
      } catch {
        // 音は無くても撮れる
      }
    },
    beep(secondsLeft) {
      try {
        if (!context || context.state === "closed") return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = secondsLeft === 0 ? 880 : 660;
        const now = context.currentTime;
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.12);
      } catch {
        // 音は無くても撮れる
      }
    },
    dispose() {
      try {
        const closing = context;
        context = null;
        void closing?.close().catch(() => {});
      } catch {
        // 音は無くても撮れる
      }
    },
  };
}
