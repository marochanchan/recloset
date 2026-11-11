// テスト用の偽カメラ。open・ready・capture・listDevices を好きなところで止められる。

import {
  CameraError,
  type CameraDevice,
  type OpenedCamera,
} from "@/lib/camera/camera-source";

export type FakeOpenedCamera = OpenedCamera & {
  stopped: boolean;
  captureCount: number;
  recordCalls: number[]; // record に渡された秒数
  recordRotations: (number | undefined)[]; // record に渡された回転
  failNextRecord(): void;
  holdRecord(): (error?: unknown) => void; // 次の record を止める。使い方は holdCapture と同じ
  video: HTMLVideoElement | null; // 最後に attach された要素
  endNow(): void;
  failNextCapture(): void;
  holdCapture(): (error?: unknown) => void; // 次の capture を止める。返した関数で完了させる（error を渡すと失敗）
  holdReady(): (error?: unknown) => void; // ready を止める。使い方は同じ
};

const DEFAULT_DEVICES: CameraDevice[] = [
  { deviceId: "cam-a", label: "カメラA" },
  { deviceId: "cam-b", label: "カメラB" },
];

// 止めた処理を、あとで完了（または失敗）させるための部品
function deferred<T>(value: T) {
  let settle!: (error?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = (error) => (error === undefined ? resolve(value) : reject(error));
  });
  return { promise, settle };
}
type Deferred<T> = ReturnType<typeof deferred<T>>;

function createFakeCamera(
  deviceId: string,
  readyHold: Deferred<void> | null,
  recordable: boolean,
): FakeOpenedCamera {
  const endedListeners = new Set<() => void>();
  let heldReady: Promise<void> | null = readyHold?.promise ?? null;
  let captureHold: Promise<Blob> | null = null;
  let captureFails = false;
  let recordHold: Promise<Blob> | null = null;
  let recordFails = false;
  const camera: FakeOpenedCamera = {
    deviceId,
    stopped: false,
    captureCount: 0,
    recordCalls: [],
    recordRotations: [],
    video: null,
    attach(video) {
      camera.video = video;
    },
    ready() {
      return heldReady ?? Promise.resolve();
    },
    capture() {
      camera.captureCount++;
      if (captureHold) {
        const held = captureHold;
        captureHold = null;
        return held;
      }
      if (captureFails) {
        captureFails = false;
        return Promise.reject(new CameraError("failed"));
      }
      return Promise.resolve(new Blob(["frame"]));
    },
    canRecord: () => recordable,
    record(seconds, signal, rotation) {
      camera.recordCalls.push(seconds);
      camera.recordRotations.push(rotation);
      const aborted = new Promise<never>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new CameraError("failed")));
      });
      if (recordHold) {
        const held = recordHold;
        recordHold = null;
        return Promise.race([held, aborted]);
      }
      if (recordFails) {
        recordFails = false;
        return Promise.reject(new CameraError("failed"));
      }
      return Promise.resolve(new Blob(["clip"], { type: "video/mp4" }));
    },
    failNextRecord() {
      recordFails = true;
    },
    holdRecord() {
      const { promise, settle } = deferred(new Blob(["clip"], { type: "video/mp4" }));
      recordHold = promise;
      return settle;
    },
    onEnded(listener) {
      endedListeners.add(listener);
      return () => {
        endedListeners.delete(listener);
      };
    },
    stop() {
      camera.stopped = true;
    },
    endNow() {
      for (const listener of [...endedListeners]) listener();
    },
    failNextCapture() {
      captureFails = true;
    },
    holdCapture() {
      const { promise, settle } = deferred(new Blob(["frame"]));
      captureHold = promise;
      return settle;
    },
    holdReady() {
      const { promise, settle } = deferred<void>(undefined);
      heldReady = promise;
      return settle;
    },
  };
  return camera;
}

export function createFakeCameraSource(
  options: { devices?: CameraDevice[]; supported?: boolean; recordable?: boolean } = {},
) {
  let devices = options.devices ?? DEFAULT_DEVICES;
  const supported = options.supported ?? true;
  const recordable = options.recordable ?? true;
  const deviceListeners = new Set<() => void>();
  const openFailures: unknown[] = [];
  const openHolds: Deferred<null>[] = [];
  const readyHolds: Deferred<void>[] = [];
  const listHolds: Deferred<null>[] = [];

  function defaultDeviceId(): string {
    if (devices.length === 0) throw new CameraError("not_found");
    return devices[0].deviceId;
  }

  function makeCamera(requested: string | null): FakeOpenedCamera {
    if (
      requested !== null &&
      !devices.some((device) => device.deviceId === requested)
    ) {
      throw new CameraError("not_found");
    }
    const camera = createFakeCamera(
      requested ?? defaultDeviceId(),
      readyHolds.shift() ?? null,
      recordable,
    );
    source.opened.push(camera);
    return camera;
  }

  const source = {
    openCalls: [] as (string | null)[],
    opened: [] as FakeOpenedCamera[],
    isSupported: () => supported,
    async open(requested: string | null): Promise<OpenedCamera> {
      source.openCalls.push(requested);
      if (openFailures.length > 0) throw openFailures.shift();
      // 止めた open は、完了させた時点で初めてカメラができる
      const hold = openHolds.shift();
      if (hold) await hold.promise;
      return makeCamera(requested);
    },
    async listDevices(): Promise<CameraDevice[]> {
      // 止めた呼び出しは、呼んだ時点の一覧を、完了させた時に返す（古い一覧が遅れて届く状況を作れる）
      const snapshot = devices;
      const hold = listHolds.shift();
      if (hold) await hold.promise;
      return snapshot;
    },
    onDevicesChanged(listener: () => void) {
      deviceListeners.add(listener);
      return () => {
        deviceListeners.delete(listener);
      };
    },
    deviceListenerCount: () => deviceListeners.size,
    failNextOpen(error: unknown) {
      openFailures.push(error);
    },
    holdNextOpen() {
      const hold = deferred<null>(null);
      openHolds.push(hold);
      return hold.settle;
    },
    holdNextReady() {
      const hold = deferred<void>(undefined);
      readyHolds.push(hold);
      return hold.settle;
    },
    holdNextListDevices() {
      const hold = deferred<null>(null);
      listHolds.push(hold);
      return () => hold.settle();
    },
    setDevices(next: CameraDevice[]) {
      devices = next;
      for (const listener of [...deviceListeners]) listener();
    },
  };
  return source;
}
