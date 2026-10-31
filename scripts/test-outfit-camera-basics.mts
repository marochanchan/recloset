// カメラの型と計算部分（lib/camera/）の自動テスト。ブラウザにも実カメラにも依存しない。
//
// 実行方法:
//   node --test scripts/test-outfit-camera-basics.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(`${repoRoot}${specifier.slice(2)}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { CameraError, cameraErrorMessage, toCameraError } = await import(
  "../lib/camera/camera-source.ts"
);
const { previewLayout } = await import("../lib/camera/camera-preview-layout.ts");
const { loadCameraPreferences, saveCameraPreferences } = await import(
  "../lib/camera/camera-preferences.ts"
);
const { CAMERA_READY_TIMEOUT_MS, createReadyGate } = await import(
  "../lib/camera/camera-ready-gate.ts"
);

const EMPTY = { lastDeviceId: null, rotations: {} };

test("toCameraError maps browser error names", () => {
  const cases: Array<[string, string]> = [
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "not_found"],
    ["OverconstrainedError", "not_found"],
    ["NotReadableError", "in_use"],
    ["AbortError", "in_use"],
  ];
  for (const [name, reason] of cases) {
    const error = toCameraError(new DOMException("x", name));
    assert.ok(error instanceof CameraError);
    assert.equal(error.reason, reason, name);
    assert.equal(error.name, "CameraError");
  }
  assert.equal(toCameraError(new TypeError("x")).reason, "failed");
  assert.equal(toCameraError("boom").reason, "failed");
  assert.equal(toCameraError(null).reason, "failed");
  const own = new CameraError("disconnected");
  assert.equal(toCameraError(own), own);
});

test("cameraErrorMessage has a message for every reason and none is raw", () => {
  const reasons = [
    "unsupported",
    "permission_denied",
    "not_found",
    "in_use",
    "disconnected",
    "failed",
  ] as const;
  const messages = new Set<string>();
  for (const reason of reasons) {
    const message = cameraErrorMessage(reason);
    assert.ok(message.length > 0, reason);
    assert.notEqual(message, reason);
    messages.add(message);
  }
  assert.equal(messages.size, 6);
  for (const reason of ["permission_denied", "not_found", "unsupported"] as const) {
    assert.ok(cameraErrorMessage(reason).includes("写真を選んで"), reason);
  }
  assert.equal(
    cameraErrorMessage("in_use"),
    "カメラがほかのアプリで使われているようです。閉じてから、もう一度お試しください",
  );
});

test("previewLayout: landscape, no rotation", () => {
  assert.deepEqual(previewLayout({ width: 1280, height: 720 }, 0), {
    aspect: 1280 / 720,
    widthPercent: 100,
    heightPercent: 100,
    transform: "translate(-50%, -50%) scaleX(-1)",
  });
});

test("previewLayout: camera turned sideways", () => {
  const frame = { width: 1280, height: 720 };
  for (const rotation of [90, 270] as const) {
    assert.deepEqual(previewLayout(frame, rotation), {
      aspect: 720 / 1280,
      widthPercent: (1280 / 720) * 100,
      heightPercent: (720 / 1280) * 100,
      transform: `translate(-50%, -50%) scaleX(-1) rotate(${rotation}deg)`,
    });
  }
  const upsideDown = previewLayout(frame, 180);
  assert.equal(upsideDown.aspect, 1280 / 720);
  assert.equal(upsideDown.widthPercent, 100);
  assert.equal(upsideDown.heightPercent, 100);
  assert.equal(upsideDown.transform, "translate(-50%, -50%) scaleX(-1) rotate(180deg)");
});

function dummyStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test("preferences round trip", () => {
  const storage = dummyStorage();
  const preferences = { lastDeviceId: "cam-1", rotations: { "cam-1": 90, "cam-2": 270 } } as const;
  saveCameraPreferences(storage, preferences);
  assert.ok(storage.data.has("recloset.camera.v1"));
  assert.deepEqual(loadCameraPreferences(storage), preferences);
});

test("preferences fall back when storage is broken or unavailable", () => {
  assert.deepEqual(loadCameraPreferences(null), EMPTY);
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadCameraPreferences(throwing), EMPTY);
  const bad = ["{not json", '{"lastDeviceId":"a","rotations":[]}', '{"lastDeviceId":5,"rotations":{}}'];
  for (const raw of bad) {
    const storage = dummyStorage();
    storage.data.set("recloset.camera.v1", raw);
    assert.deepEqual(loadCameraPreferences(storage), EMPTY, raw);
  }
  const mixed = dummyStorage();
  mixed.data.set(
    "recloset.camera.v1",
    JSON.stringify({ lastDeviceId: "a", rotations: { a: 90, b: 45, c: "90", d: 0 } }),
  );
  assert.deepEqual(loadCameraPreferences(mixed), {
    lastDeviceId: "a",
    rotations: { a: 90, d: 0 },
  });
  assert.doesNotThrow(() => saveCameraPreferences(throwing, EMPTY));
  assert.doesNotThrow(() => saveCameraPreferences(null, EMPTY));
});

test("ready gate settles once and clears its timer", async (t) => {
  for (const settle of ["resolve", "reject"] as const) {
    const clear = t.mock.method(globalThis, "clearTimeout");
    const gate = createReadyGate();
    const error = new CameraError("disconnected");
    if (settle === "resolve") {
      gate.resolve();
      gate.reject(error); // 決着後は無視
      await gate.promise;
    } else {
      gate.reject(error);
      gate.resolve(); // 決着後は無視
      await assert.rejects(gate.promise, (e) => e === error);
    }
    assert.equal(clear.mock.callCount(), 1, settle);
    clear.mock.restore();
  }
});

test("ready gate times out after 10 seconds", async (t) => {
  assert.equal(CAMERA_READY_TIMEOUT_MS, 10_000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = createReadyGate();
  let settled = false;
  gate.promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  t.mock.timers.tick(9999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await assert.rejects(gate.promise, (e) => e instanceof CameraError && e.reason === "failed");
});

test("ready gate never leaves an unhandled rejection", async () => {
  let count = 0;
  const onUnhandled = () => count++;
  process.on("unhandledRejection", onUnhandled);
  try {
    createReadyGate().reject(new CameraError("failed"));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(count, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
