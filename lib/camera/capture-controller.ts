// 撮影の流れ（カメラを開く → カウントダウン → 撮る → 確認）を持つ状態機械。
// React には依存しない。画面側は getState / subscribe で描くだけ。
// カメラまわりの競合（開いている途中で閉じる、切り替えを重ねる、抜かれる）はすべてここで解く。

import {
  toCameraError,
  type CameraDevice,
  type CameraErrorReason,
  type CameraSource,
  type OpenedCamera,
} from "@/lib/camera/camera-source";
import {
  loadCameraPreferences,
  saveCameraPreferences,
  type CameraPreferences,
  type PreferenceStorage,
} from "@/lib/camera/camera-preferences";
import type { CaptureTrigger } from "@/lib/camera/capture-trigger";
import {
  getNextRotation,
  type ImageRotation,
  type ProcessedImage,
} from "@/lib/image-processing";

export const COUNTDOWN_SECONDS = 5;

const CAPTURE_FAILED_MESSAGE = "撮れませんでした。もう一度お試しください";
const RECORD_FAILED_MESSAGE = "録画できませんでした。もう一度お試しください";

// 撮り方。写真か、5秒・8秒の動画
export type CaptureMode = "photo" | "video5" | "video8";
const VIDEO_SECONDS: Record<CaptureMode, number> = { photo: 0, video5: 5, video8: 8 };
export type CaptureClip = { blob: Blob; durationSec: number };

export type CapturePhase =
  | "off"
  | "opening"
  | "live"
  | "countdown"
  | "recording"
  | "picking"
  | "processing"
  | "review"
  | "unavailable";

export type CaptureState = {
  phase: CapturePhase;
  secondsLeft: number | null; // countdown・recording のときだけ
  mode: CaptureMode;
  canRecord: boolean; // このカメラで動画を録れるか（live のあいだ有効）
  clip: CaptureClip | null; // picking（と、そこから処理中）のときだけ
  devices: CameraDevice[];
  deviceId: string | null;
  rotation: ImageRotation;
  photo: ProcessedImage | null; // review のときだけ（回転まで反映した、保存される写真）
  errorReason: CameraErrorReason | null; // unavailable のときだけ
  message: string | null; // live に戻ったときの一言
};

export type CaptureController = {
  getState(): CaptureState; // 変わらない間は同じオブジェクトを返す（useSyncExternalStore 用）
  subscribe(listener: () => void): () => void;
  attachVideo(video: HTMLVideoElement | null): void;
  start(): Promise<void>;
  selectDevice(deviceId: string): Promise<void>;
  rotate(): void; // live のときだけ効く
  setMode(mode: CaptureMode): void; // live のときだけ効く。録れないカメラでは動画を選べない
  cancelCountdown(): void; // カウントダウン中・録画中に止める
  useFrame(frame: Blob): Promise<void>; // picking で選んだコマを写真にする
  retake(): Promise<void>;
  // picking の動画と向きを呼び出し側に渡して、カメラを止めて off に戻る（コマ選びは呼び出し側が持つ）。picking 以外は null
  handOffClip(): { clip: CaptureClip; rotation: ImageRotation } | null;
  keep(): ProcessedImage | null; // 写真を返して off へ。2回目は null
  suspend(): void; // 画面が隠れた。確認中の写真だけ残す
  close(): void; // 全部やめる
};

const INITIAL_STATE: CaptureState = {
  phase: "off",
  secondsLeft: null,
  mode: "photo",
  canRecord: false,
  clip: null,
  devices: [],
  deviceId: null,
  rotation: 0,
  photo: null,
  errorReason: null,
  message: null,
};

export function createCaptureController(deps: {
  source: CameraSource;
  trigger: CaptureTrigger;
  process: (frame: Blob, rotation: ImageRotation) => Promise<ProcessedImage>;
  storage: PreferenceStorage | null;
  onTick?: (secondsLeft: number) => void; // 5,4,3,2,1,0。音に使う
}): CaptureController {
  const { source, trigger, process, storage, onTick } = deps;

  let state: CaptureState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  let preferences: CameraPreferences = { lastDeviceId: null, rotations: {} };

  // 開くたび・止めるたびに増やす世代。await のあとで古ければ、何も変えずに手を引く
  let generation = 0;
  // 機器一覧の取得ごとに増やす連番。古い応答が新しい一覧を上書きしないようにする
  let listSequence = 0;
  let camera: OpenedCamera | null = null;
  let video: HTMLVideoElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 録画ごとに増やす。取りやめた録画の結果を捨てる（camera の世代とは別）
  let recordToken = 0;
  let recordAbort: AbortController | null = null;
  let unsubscribeEnded: (() => void) | null = null;
  let unsubscribeDevices: (() => void) | null = null;
  let unsubscribeTrigger: (() => void) | null = null;

  function setState(patch: Partial<CaptureState>) {
    const next = { ...state, ...patch };
    // live を離れたら一言は消す（次のカウントダウンに古い一言を持ち越さない）
    if (
      patch.phase !== undefined &&
      patch.phase !== "live" &&
      patch.message === undefined
    ) {
      next.message = null;
    }
    state = next;
    for (const listener of [...listeners]) listener();
  }

  // カメラを止める処理はここだけ。タイマー、登録の解除、stop()、世代の更新をまとめて行う
  function stopEverything() {
    generation++;
    recordToken++;
    recordAbort?.abort();
    recordAbort = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribeEnded?.();
    unsubscribeDevices?.();
    unsubscribeTrigger?.();
    unsubscribeEnded = unsubscribeDevices = unsubscribeTrigger = null;
    camera?.stop();
    camera = null;
  }

  function fail(reason: CameraErrorReason) {
    stopEverything();
    setState({
      phase: "unavailable",
      secondsLeft: null,
      photo: null,
      clip: null,
      errorReason: reason,
    });
  }

  function handleEnded() {
    if (state.phase === "review" || state.phase === "picking") {
      // 確認中の写真・選び中の動画は残す。開き直すのは retake のとき
      stopEverything();
    } else if (
      state.phase === "opening" ||
      state.phase === "live" ||
      state.phase === "countdown" ||
      state.phase === "recording" ||
      state.phase === "processing"
    ) {
      fail("disconnected");
    }
  }

  function safeTick(secondsLeft: number) {
    try {
      onTick?.(secondsLeft);
    } catch {
      // 音の失敗で撮影を止めない
    }
  }

  function showCountdown(secondsLeft: number) {
    safeTick(secondsLeft);
    if (secondsLeft === 0) {
      timer = null;
      if (state.mode === "photo") void capture();
      else void record(VIDEO_SECONDS[state.mode]);
      return;
    }
    setState({ phase: "countdown", secondsLeft });
    timer = setTimeout(() => showCountdown(secondsLeft - 1), 1000);
  }

  async function capture() {
    const current = camera;
    if (!current) return;
    const myGeneration = generation;
    setState({ phase: "processing", secondsLeft: null });
    try {
      const frame = await current.capture();
      if (generation !== myGeneration) return;
      const photo = await process(frame, state.rotation);
      if (generation !== myGeneration) return;
      setState({ phase: "review", photo });
    } catch {
      if (generation !== myGeneration) return;
      setState({ phase: "live", photo: null, message: CAPTURE_FAILED_MESSAGE });
    }
  }

  // 録画の残り秒の表示。録れたかどうかは record() の結果で決まる
  function showRecording(secondsLeft: number) {
    setState({ phase: "recording", secondsLeft });
    if (secondsLeft > 1) {
      timer = setTimeout(() => showRecording(secondsLeft - 1), 1000);
    } else {
      timer = null;
    }
  }

  async function record(seconds: number) {
    const current = camera;
    if (!current) return;
    const myGeneration = generation;
    const myToken = ++recordToken;
    const abort = new AbortController();
    recordAbort = abort;
    showRecording(seconds);
    try {
      const blob = await current.record(seconds, abort.signal);
      if (generation !== myGeneration || recordToken !== myToken) return;
      recordAbort = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      setState({ phase: "picking", secondsLeft: null, clip: { blob, durationSec: seconds } });
    } catch {
      if (generation !== myGeneration || recordToken !== myToken) return;
      recordAbort = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      setState({ phase: "live", secondsLeft: null, clip: null, message: RECORD_FAILED_MESSAGE });
    }
  }

  function handleTrigger() {
    if (state.phase !== "live") return;
    showCountdown(COUNTDOWN_SECONDS);
  }

  async function openCamera(
    requested: string | null,
    fallbackToDefault: boolean,
  ) {
    stopEverything();
    const myGeneration = generation;
    setState({
      phase: "opening",
      secondsLeft: null,
      photo: null,
      clip: null,
      errorReason: null,
    });
    if (!source.isSupported()) {
      fail("unsupported");
      return;
    }
    preferences = loadCameraPreferences(storage);
    try {
      let opened: OpenedCamera;
      try {
        opened = await source.open(requested);
      } catch (error) {
        if (generation !== myGeneration) return;
        if (
          requested === null ||
          !fallbackToDefault ||
          toCameraError(error).reason !== "not_found"
        ) {
          throw error;
        }
        // 覚えていたカメラが無くなっていたら、既定のカメラで一度だけやり直す
        opened = await source.open(null);
      }
      if (generation !== myGeneration) {
        opened.stop(); // 遅れて届いたカメラは使わない
        return;
      }
      camera = opened;
      if (video) opened.attach(video);
      unsubscribeEnded = opened.onEnded(handleEnded);
      unsubscribeDevices = source.onDevicesChanged(
        () => void refreshDevices(myGeneration),
      );

      await opened.ready();
      if (generation !== myGeneration) return;
      const listId = ++listSequence;
      let devices: CameraDevice[];
      try {
        devices = await source.listDevices();
      } catch {
        devices = [];
      }
      if (generation !== myGeneration) return;
      // 取得中に、より新しい一覧の要求があった。この古い一覧は捨てて、状態遷移だけ続ける
      if (listId !== listSequence) devices = state.devices;

      unsubscribeTrigger = trigger.subscribe(handleTrigger);
      preferences = { ...preferences, lastDeviceId: opened.deviceId };
      const canRecord = opened.canRecord();
      setState({
        phase: "live",
        canRecord,
        mode: canRecord ? state.mode : "photo",
        devices,
        deviceId: opened.deviceId,
        rotation: preferences.rotations[opened.deviceId] ?? 0,
      });
      saveCameraPreferences(storage, preferences);
    } catch (error) {
      if (generation !== myGeneration) return;
      fail(toCameraError(error).reason);
    }
  }

  async function refreshDevices(myGeneration: number) {
    const listId = ++listSequence;
    try {
      const devices = await source.listDevices();
      if (generation !== myGeneration || listId !== listSequence) return;
      setState({ devices });
    } catch {
      // 一覧を取り直せなくても、今のカメラはそのまま使える
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachVideo(next) {
      // video 要素は open が終わったあとに出てくることもあるので、覚えておく
      video = next;
      camera?.attach(next);
    },
    async start() {
      if (state.phase !== "off" && state.phase !== "unavailable") return;
      await openCamera(loadCameraPreferences(storage).lastDeviceId, true);
    },
    async selectDevice(deviceId) {
      if (state.phase !== "opening" && state.phase !== "live") return;
      await openCamera(deviceId, false);
    },
    rotate() {
      if (state.phase !== "live" || state.deviceId === null) return;
      const rotation = getNextRotation(state.rotation);
      preferences = {
        ...preferences,
        rotations: { ...preferences.rotations, [state.deviceId]: rotation },
      };
      saveCameraPreferences(storage, preferences);
      setState({ rotation });
    },
    setMode(mode) {
      if (state.phase !== "live") return;
      if (mode !== "photo" && !state.canRecord) return;
      setState({ mode });
    },
    cancelCountdown() {
      if (state.phase !== "countdown" && state.phase !== "recording") return;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // 録画中なら止めて、結果は捨てる
      recordToken++;
      recordAbort?.abort();
      recordAbort = null;
      setState({ phase: "live", secondsLeft: null, clip: null });
    },
    async useFrame(frame) {
      if (state.phase !== "picking" || !state.clip) return;
      const myGeneration = generation;
      const rotation = state.rotation;
      setState({ phase: "processing", secondsLeft: null });
      try {
        const photo = await process(frame, rotation);
        if (generation !== myGeneration) return;
        setState({ phase: "review", photo, clip: null });
      } catch {
        if (generation !== myGeneration) return;
        // 動画は残して、選び直せるようにする
        setState({ phase: "picking", message: CAPTURE_FAILED_MESSAGE });
      }
    },
    async retake() {
      if (state.phase !== "review" && state.phase !== "picking") return;
      if (camera) {
        // カメラが生きている間は開き直さない
        setState({ phase: "live", photo: null, clip: null });
        return;
      }
      await openCamera(state.deviceId, true);
    },
    handOffClip() {
      if (state.phase !== "picking" || !state.clip) return null;
      const handed = { clip: state.clip, rotation: state.rotation };
      stopEverything();
      setState({ ...INITIAL_STATE });
      return handed;
    },
    keep() {
      if (state.phase !== "review" || !state.photo) return null;
      const photo = state.photo;
      stopEverything();
      setState({ ...INITIAL_STATE });
      return photo;
    },
    suspend() {
      if (state.phase === "off" || state.phase === "unavailable") return;
      stopEverything();
      if (state.phase === "review") return; // 確認中の写真だけ残す
      setState({ phase: "off", secondsLeft: null, photo: null, clip: null });
    },
    close() {
      stopEverything();
      setState({ ...INITIAL_STATE });
    },
  };
}
