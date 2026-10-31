// 撮影の流れ（lib/camera/capture-controller.ts）の自動テスト。偽のカメラと偽のタイマーだけで動く。
//
// 実行方法:
//   node --test scripts/test-outfit-camera-controller.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        pathToFileURL(`${repoRoot}${specifier.slice(2)}.ts`).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});

const { CameraError } = await import("../lib/camera/camera-source.ts");
const { createManualTrigger } =
  await import("../lib/camera/capture-trigger.ts");
const { createFakeCameraSource } =
  await import("../lib/camera/fake-camera-source.ts");
const { COUNTDOWN_SECONDS, createCaptureController } =
  await import("../lib/camera/capture-controller.ts");

const STORAGE_KEY = "recloset.camera.v1";
const FAILED_MESSAGE = "撮れませんでした。もう一度お試しください";
const DEVICES = [
  { deviceId: "cam-a", label: "カメラA" },
  { deviceId: "cam-b", label: "カメラB" },
];

// モックのタイマーは setTimeout だけ。Promise を流す待ちは本物の setImmediate を使う。
async function flush() {
  for (let i = 0; i < 5; i++)
    await new Promise((resolve) => setImmediate(resolve));
}

function dummyStorage(initial?: unknown) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, JSON.stringify(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    saved: () => JSON.parse(data.get(STORAGE_KEY) ?? "null"),
  };
}

function setup(
  t: TestContext,
  options: { stored?: unknown; supported?: boolean } = {},
) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = createFakeCameraSource({
    devices: DEVICES,
    supported: options.supported,
  });
  const manual = createManualTrigger();
  let unsubscribeCount = 0;
  const trigger = {
    subscribe(fire: () => void) {
      const off = manual.subscribe(fire);
      return () => {
        unsubscribeCount++;
        off();
      };
    },
  };
  const storage = dummyStorage(options.stored);

  // process のダミー。受け取った引数を記録し、止めたり失敗させたりできる
  const processCalls: Array<{ frame: Blob; rotation: number }> = [];
  let holdNextProcess = false;
  let failNextProcess = false;
  let releaseProcess: () => void = () => {};
  const process = (frame: Blob, rotation: number) => {
    processCalls.push({ frame, rotation });
    const result = { blob: new Blob(["photo"]), width: 1280, height: 720 };
    if (failNextProcess) {
      failNextProcess = false;
      return Promise.reject(new Error("process failed"));
    }
    if (holdNextProcess) {
      holdNextProcess = false;
      return new Promise<typeof result>((resolve) => {
        releaseProcess = () => resolve(result);
      });
    }
    return Promise.resolve(result);
  };

  const ticks: number[] = [];
  const controller = createCaptureController({
    source,
    trigger,
    process,
    storage,
    onTick: (seconds: number) => ticks.push(seconds),
  });
  const notifications = { count: 0 };
  controller.subscribe(() => notifications.count++);

  // 1秒ずつ進めて、そのたびに Promise を流す（タイマーは1秒ずつつながっているため）
  async function advanceSeconds(n: number) {
    for (let i = 0; i < n; i++) {
      t.mock.timers.tick(1000);
      await flush();
    }
  }
  const lastCamera = () => source.opened[source.opened.length - 1];
  return {
    source,
    manual,
    storage,
    controller,
    processCalls,
    ticks,
    notifications,
    advanceSeconds,
    unsubscribeCount: () => unsubscribeCount,
    holdProcess: () => void (holdNextProcess = true),
    failProcess: () => void (failNextProcess = true),
    releaseProcess: () => releaseProcess(),
    async startLive() {
      await controller.start();
      assert.equal(controller.getState().phase, "live");
      return lastCamera();
    },
    async startCountdown() {
      await controller.start();
      manual.fire();
      assert.equal(controller.getState().phase, "countdown");
      return lastCamera();
    },
    async startReview() {
      const camera = await this.startCountdown();
      await advanceSeconds(COUNTDOWN_SECONDS);
      assert.equal(controller.getState().phase, "review");
      return camera;
    },
  };
}

test("start opens the default camera", async (t) => {
  const h = setup(t);
  await h.controller.start();
  const state = h.controller.getState();
  assert.deepEqual(h.source.openCalls, [null]);
  assert.equal(state.phase, "live");
  assert.deepEqual(state.devices, DEVICES);
  assert.equal(state.deviceId, "cam-a");
  assert.equal(state.rotation, 0);
  assert.equal(state.errorReason, null);
  assert.equal(h.storage.saved().lastDeviceId, "cam-a");
});

test("start reopens the remembered camera", async (t) => {
  const h = setup(t, {
    stored: { lastDeviceId: "cam-b", rotations: { "cam-b": 90 } },
  });
  await h.controller.start();
  const state = h.controller.getState();
  assert.deepEqual(h.source.openCalls, ["cam-b"]);
  assert.equal(state.phase, "live");
  assert.equal(state.deviceId, "cam-b");
  assert.equal(state.rotation, 90);
});

test("remembered gone: falls back to the default camera", async (t) => {
  const h = setup(t, { stored: { lastDeviceId: "x", rotations: {} } });
  await h.controller.start();
  assert.deepEqual(h.source.openCalls, ["x", null]);
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().deviceId, "cam-a");
  assert.equal(h.storage.saved().lastDeviceId, "cam-a");
});

test("live only after the first frame", async (t) => {
  const h = setup(t);
  const release = h.source.holdNextReady();
  const starting = h.controller.start();
  await flush();
  assert.equal(h.controller.getState().phase, "opening");
  release();
  await starting;
  assert.equal(h.controller.getState().phase, "live");
});

test("close while waiting for ready", async (t) => {
  for (const fails of [false, true]) {
    await t.test(
      fails ? "ready fails later" : "ready completes later",
      async (sub) => {
        const h = setup(sub);
        const release = h.source.holdNextReady();
        const starting = h.controller.start();
        await flush();
        h.controller.close();
        assert.equal(
          h.source.opened[0].stopped,
          true,
          `stopped (fails=${fails})`,
        );
        assert.equal(h.controller.getState().phase, "off");
        release(fails ? new CameraError("failed") : undefined);
        await starting;
        await flush();
        assert.equal(
          h.controller.getState().phase,
          "off",
          `off (fails=${fails})`,
        );
        assert.equal(h.controller.getState().errorReason, null);
      },
    );
  }
});

test("ended while waiting for ready", async (t) => {
  const h = setup(t);
  const release = h.source.holdNextReady();
  const starting = h.controller.start();
  await flush();
  h.source.opened[0].endNow();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "disconnected");
  assert.equal(h.source.opened[0].stopped, true);
  release();
  await starting;
  await flush();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "disconnected");
});

test("ready failure stops the camera", async (t) => {
  const h = setup(t);
  const release = h.source.holdNextReady();
  const starting = h.controller.start();
  await flush();
  release(new CameraError("failed"));
  await starting;
  assert.equal(h.source.opened[0].stopped, true);
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "failed");
  assert.equal(h.storage.data.has(STORAGE_KEY), false);
});

test("unsupported never calls open", async (t) => {
  const h = setup(t, { supported: false });
  await h.controller.start();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "unsupported");
  assert.deepEqual(h.source.openCalls, []);
});

test("permission denied, then start again works", async (t) => {
  const h = setup(t);
  h.source.failNextOpen(new DOMException("denied", "NotAllowedError"));
  await h.controller.start();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "permission_denied");
  await h.controller.start();
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().errorReason, null);
  assert.equal(h.source.openCalls.length, 2);
});

test("countdown shows 5 to 1, then captures once", async (t) => {
  const h = setup(t);
  const camera = await h.startLive();
  h.manual.fire();
  assert.equal(h.controller.getState().phase, "countdown");
  assert.equal(h.controller.getState().secondsLeft, 5);
  await h.advanceSeconds(4);
  assert.equal(h.controller.getState().phase, "countdown");
  assert.equal(h.controller.getState().secondsLeft, 1);
  assert.equal(camera.captureCount, 0);
  await h.advanceSeconds(1);
  assert.equal(camera.captureCount, 1);
  const state = h.controller.getState();
  assert.equal(state.phase, "review");
  assert.equal(state.secondsLeft, null);
  assert.equal(state.photo?.width, 1280);
  assert.equal(state.photo?.height, 720);
  assert.equal(h.processCalls.length, 1);
  assert.equal(h.processCalls[0].rotation, 0);
});

test("capture passes the current rotation to process", async (t) => {
  const h = setup(t);
  await h.startLive();
  h.controller.rotate();
  h.controller.rotate();
  h.manual.fire();
  await h.advanceSeconds(5);
  assert.equal(h.processCalls[0].rotation, 180);
  assert.equal(h.controller.getState().rotation, 180);
});

test("onTick order", async (t) => {
  const h = setup(t);
  await h.startLive();
  h.manual.fire();
  await h.advanceSeconds(5);
  assert.deepEqual(h.ticks, [5, 4, 3, 2, 1, 0]);
});

test("second trigger does not restart the countdown", async (t) => {
  const h = setup(t);
  const camera = await h.startLive();
  h.manual.fire();
  await h.advanceSeconds(2);
  h.manual.fire();
  assert.equal(h.controller.getState().secondsLeft, 3);
  await h.advanceSeconds(3);
  assert.equal(camera.captureCount, 1);
  await h.advanceSeconds(10);
  assert.equal(camera.captureCount, 1);
});

test("trigger is ignored outside live", async (t) => {
  const h = setup(t);
  h.manual.fire();
  assert.equal(h.controller.getState().phase, "off");
  assert.equal(h.notifications.count, 0);

  await h.startLive();
  h.holdProcess();
  h.manual.fire();
  await h.advanceSeconds(5);
  const processing = h.controller.getState();
  assert.equal(processing.phase, "processing");
  h.manual.fire();
  assert.equal(h.controller.getState(), processing);

  h.releaseProcess();
  await flush();
  const review = h.controller.getState();
  assert.equal(review.phase, "review");
  h.manual.fire();
  assert.equal(h.controller.getState(), review);
  await h.advanceSeconds(10);
  assert.equal(h.source.opened[0].captureCount, 1);
});

test("cancelCountdown returns to live and never captures", async (t) => {
  const h = setup(t);
  const camera = await h.startCountdown();
  await h.advanceSeconds(2);
  h.controller.cancelCountdown();
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().secondsLeft, null);
  await h.advanceSeconds(10);
  assert.equal(camera.captureCount, 0);
  assert.equal(h.controller.getState().phase, "live");
});

test("capture failure returns to live with a message", async (t) => {
  const h = setup(t);
  const camera = await h.startLive();
  camera.failNextCapture();
  h.manual.fire();
  await h.advanceSeconds(5);
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().message, FAILED_MESSAGE);
  assert.equal(h.controller.getState().photo, null);

  // 次のカウントダウンを始めると、古い一言は消える
  h.manual.fire();
  assert.equal(h.controller.getState().message, null);
  h.failProcess();
  await h.advanceSeconds(5);
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().message, FAILED_MESSAGE);
  assert.equal(camera.captureCount, 2);
});

test("retake while the stream is alive", async (t) => {
  const h = setup(t);
  await h.startReview();
  assert.equal(h.source.opened[0].stopped, false);
  await h.controller.retake();
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().photo, null);
  assert.equal(h.source.openCalls.length, 1);
  h.manual.fire();
  assert.equal(h.controller.getState().phase, "countdown");
});

test("keep once", async (t) => {
  const h = setup(t);
  const camera = await h.startReview();
  const expected = h.controller.getState().photo;
  const photo = h.controller.keep();
  assert.equal(photo, expected);
  assert.equal(photo?.width, 1280);
  assert.equal(camera.stopped, true);
  assert.equal(h.controller.getState().phase, "off");
  assert.equal(h.controller.getState().photo, null);
  assert.equal(h.controller.keep(), null);
});

test("close during open stops the late stream", async (t) => {
  const h = setup(t);
  const release = h.source.holdNextOpen();
  const starting = h.controller.start();
  await flush();
  h.controller.close();
  release();
  await starting;
  await flush();
  assert.equal(h.source.opened.length, 1);
  assert.equal(h.source.opened[0].stopped, true);
  assert.equal(h.controller.getState().phase, "off");
});

test("switch twice: only the last camera stays", async (t) => {
  const h = setup(t);
  await h.startLive();
  const releaseFirst = h.source.holdNextOpen();
  const releaseSecond = h.source.holdNextOpen();
  const first = h.controller.selectDevice("cam-b");
  const second = h.controller.selectDevice("cam-a");
  await flush();
  assert.equal(h.controller.getState().phase, "opening");
  assert.equal(h.source.opened[0].stopped, true);
  // あとの呼び出しが先に完了し、先の呼び出しが遅れて届く
  releaseSecond();
  await second;
  releaseFirst();
  await first;
  await flush();
  assert.deepEqual(h.source.openCalls, [null, "cam-b", "cam-a"]);
  // opened は完了した順。あとの呼び出し（cam-a）が先に届き、先の呼び出し（cam-b）が遅れて届く
  const [initial, last, lateArrival] = h.source.opened;
  assert.equal(initial.stopped, true);
  assert.equal(last.deviceId, "cam-a");
  assert.equal(last.stopped, false);
  assert.equal(lateArrival.deviceId, "cam-b");
  assert.equal(lateArrival.stopped, true);
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().deviceId, "cam-a");
});

test("late failure of a replaced open is ignored", async (t) => {
  const h = setup(t);
  const failFirst = h.source.holdNextOpen();
  const starting = h.controller.start();
  await flush();
  await h.controller.selectDevice("cam-b");
  assert.equal(h.controller.getState().phase, "live");
  failFirst(new CameraError("in_use"));
  await starting;
  await flush();
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().errorReason, null);
  assert.equal(h.controller.getState().deviceId, "cam-b");
  assert.equal(h.source.opened[0].stopped, false);
});

test("failed switch keeps the last good camera remembered", async (t) => {
  const h = setup(t);
  await h.startLive();
  h.source.failNextOpen(new CameraError("in_use"));
  await h.controller.selectDevice("cam-b");
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "in_use");
  assert.equal(h.source.opened[0].stopped, true);
  assert.equal(h.storage.saved().lastDeviceId, "cam-a");
  await h.controller.start();
  assert.equal(h.source.openCalls[h.source.openCalls.length - 1], "cam-a");
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().deviceId, "cam-a");
});

test("suspend during countdown", async (t) => {
  const h = setup(t);
  const camera = await h.startCountdown();
  await h.advanceSeconds(2);
  h.controller.suspend();
  assert.equal(camera.stopped, true);
  assert.equal(h.controller.getState().phase, "off");
  assert.equal(h.controller.getState().secondsLeft, null);
  await h.advanceSeconds(10);
  assert.equal(camera.captureCount, 0);
  assert.equal(h.controller.getState().phase, "off");
});

test("suspend during processing drops the result", async (t) => {
  const h = setup(t);
  await h.startLive();
  h.holdProcess();
  h.manual.fire();
  await h.advanceSeconds(5);
  assert.equal(h.controller.getState().phase, "processing");
  h.controller.suspend();
  assert.equal(h.controller.getState().phase, "off");
  h.releaseProcess();
  await flush();
  assert.equal(h.controller.getState().phase, "off");
  assert.equal(h.controller.getState().photo, null);
  assert.equal(h.source.opened[0].stopped, true);
});

test("suspend during review keeps the photo", async (t) => {
  const h = setup(t);
  const camera = await h.startReview();
  const photo = h.controller.getState().photo;
  h.controller.suspend();
  assert.equal(h.controller.getState().phase, "review");
  assert.equal(h.controller.getState().photo, photo);
  assert.equal(camera.stopped, true);
  await h.controller.retake();
  assert.equal(h.source.openCalls.length, 2);
  assert.equal(h.controller.getState().phase, "live");
  assert.equal(h.controller.getState().photo, null);
});

test("ended during countdown", async (t) => {
  const h = setup(t);
  const camera = await h.startCountdown();
  await h.advanceSeconds(2);
  camera.endNow();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "disconnected");
  assert.equal(camera.stopped, true);
  await h.advanceSeconds(10);
  assert.equal(camera.captureCount, 0);
  assert.equal(h.controller.getState().phase, "unavailable");
});

test("ended during processing", async (t) => {
  const h = setup(t);
  const camera = await h.startLive();
  h.holdProcess();
  h.manual.fire();
  await h.advanceSeconds(5);
  assert.equal(h.controller.getState().phase, "processing");
  camera.endNow();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "disconnected");
  h.releaseProcess();
  await flush();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().photo, null);
});

test("ended during capture", async (t) => {
  const h = setup(t);
  const camera = await h.startLive();
  const releaseCapture = camera.holdCapture();
  h.manual.fire();
  await h.advanceSeconds(5);
  assert.equal(camera.captureCount, 1);
  camera.endNow();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "disconnected");
  releaseCapture(new CameraError("failed"));
  await flush();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().message, null);
  assert.equal(h.processCalls.length, 0);
});

test("ended while opening", async (t) => {
  const h = setup(t);
  const release = h.source.holdNextListDevices();
  const starting = h.controller.start();
  await flush();
  assert.equal(h.controller.getState().phase, "opening");
  h.source.opened[0].endNow();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.controller.getState().errorReason, "disconnected");
  release();
  await starting;
  await flush();
  assert.equal(h.controller.getState().phase, "unavailable");
  assert.equal(h.source.opened[0].stopped, true);
});

test("ended during review keeps the photo", async (t) => {
  const h = setup(t);
  const camera = await h.startReview();
  const photo = h.controller.getState().photo;
  camera.endNow();
  assert.equal(h.controller.getState().phase, "review");
  assert.equal(h.controller.getState().photo, photo);
  assert.equal(camera.stopped, true);
  await h.controller.retake();
  assert.equal(h.source.openCalls.length, 2);
  assert.equal(h.controller.getState().phase, "live");
});

test("rotate is remembered per camera", async (t) => {
  const h = setup(t);
  await h.startLive();
  h.controller.rotate();
  assert.equal(h.controller.getState().rotation, 90);
  assert.deepEqual(h.storage.saved().rotations, { "cam-a": 90 });

  await h.controller.selectDevice("cam-b");
  assert.equal(h.controller.getState().rotation, 0);
  await h.controller.selectDevice("cam-a");
  assert.equal(h.controller.getState().rotation, 90);

  h.manual.fire();
  h.controller.rotate();
  assert.equal(h.controller.getState().rotation, 90);
  assert.equal(h.controller.getState().phase, "countdown");
  assert.deepEqual(h.storage.saved().rotations, { "cam-a": 90 });
});

test("device list follows changes while open", async (t) => {
  const h = setup(t);
  await h.startLive();
  assert.equal(h.source.deviceListenerCount(), 1);
  const next = [...DEVICES, { deviceId: "cam-c", label: "カメラC" }];
  h.source.setDevices(next);
  await flush();
  assert.deepEqual(h.controller.getState().devices, next);
  h.controller.close();
  assert.equal(h.source.deviceListenerCount(), 0);
});

test("trigger is unsubscribed after close", async (t) => {
  const h = setup(t);
  const camera = await h.startLive();
  h.controller.close();
  assert.equal(h.unsubscribeCount(), 1);
  assert.equal(camera.stopped, true);
  h.manual.fire();
  assert.equal(h.controller.getState().phase, "off");
  await h.advanceSeconds(10);
  assert.equal(camera.captureCount, 0);
});

test("getState is stable between changes", async (t) => {
  const h = setup(t);
  const first = h.controller.getState();
  assert.equal(h.controller.getState(), first);
  await h.controller.start();
  const live = h.controller.getState();
  assert.notEqual(live, first);
  assert.equal(h.controller.getState(), live);
  const before = h.notifications.count;
  assert.ok(before > 0);
  h.controller.rotate();
  assert.equal(h.notifications.count, before + 1);
  assert.notEqual(h.controller.getState(), live);
});

test("attachVideo is forwarded whichever comes first", async (t) => {
  const h = setup(t);
  const video = { tag: "video" } as unknown as HTMLVideoElement;
  const release = h.source.holdNextOpen();
  const starting = h.controller.start();
  h.controller.attachVideo(video);
  release();
  await starting;
  assert.equal(h.source.opened[0].video, video);

  const later = { tag: "later" } as unknown as HTMLVideoElement;
  h.controller.attachVideo(later);
  assert.equal(h.source.opened[0].video, later);
});

test("start and retake do nothing outside their phases", async (t) => {
  const h = setup(t);
  await h.controller.retake();
  assert.deepEqual(h.source.openCalls, []);
  await h.startLive();
  await h.controller.start();
  assert.deepEqual(h.source.openCalls, [null]);
});
