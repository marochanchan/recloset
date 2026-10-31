// 最後に使ったカメラと、カメラごとの回転の記憶。壊れていても空の設定に戻すだけ。

import type { ImageRotation } from "@/lib/image-processing";

export type CameraPreferences = {
  lastDeviceId: string | null;
  rotations: Record<string, ImageRotation>;
};
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "recloset.camera.v1";

function empty(): CameraPreferences {
  return { lastDeviceId: null, rotations: {} };
}

function isRotation(value: unknown): value is ImageRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

export function loadCameraPreferences(storage: PreferenceStorage | null): CameraPreferences {
  if (!storage) return empty();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty();
    const { lastDeviceId, rotations } = parsed as Record<string, unknown>;
    if (lastDeviceId !== null && typeof lastDeviceId !== "string") return empty();
    if (typeof rotations !== "object" || rotations === null || Array.isArray(rotations)) {
      return empty();
    }
    const valid: Record<string, ImageRotation> = {};
    for (const [id, rotation] of Object.entries(rotations)) {
      if (isRotation(rotation)) valid[id] = rotation;
    }
    return { lastDeviceId, rotations: valid };
  } catch {
    return empty();
  }
}

export function saveCameraPreferences(
  storage: PreferenceStorage | null,
  preferences: CameraPreferences,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 保存できなくても撮影は続けられる
  }
}
