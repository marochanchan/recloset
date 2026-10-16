"use client";

import { Button } from "@/components/ui/button";
import {
  findNearestWeatherRegion,
  WEATHER_REGION_COOKIE,
  WEATHER_REGION_COOKIE_MAX_AGE,
  WEATHER_REGIONS,
  type WeatherRegion,
} from "@/lib/weather-regions";
import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// 位置情報は精度を下げて取得し、近い都道府県を選ぶためだけにこの端末で使う
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 10 * 60 * 1000,
};

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

// Cookieには地域キーだけを保存する（座標は保存しない）。サーバーで一覧と照合して使う
function saveRegionCookie(region: WeatherRegion) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${WEATHER_REGION_COOKIE}=${encodeURIComponent(region.key)}; Path=/; Max-Age=${WEATHER_REGION_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function getGeolocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "位置情報が許可されませんでした。都道府県を選んでください。";
  }
  return "現在地を取得できませんでした。都道府県を選んでください。";
}

/**
 * Todayの天気エリアの地域設定（「現在地から設定」と都道府県の手動選択）。
 * 未設定なら最初から開いて案内し、設定済みなら「地域を変更」で開く。
 * 保存後はページを更新し、天気と服の提案を同じ地域で選び直す。
 */
export function WeatherRegionSetting({
  currentRegionKey,
}: {
  /** サーバーで検証済みの地域キー（未設定・不正ならnull） */
  currentRegionKey: string | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isRefreshing, startTransition] = useTransition();

  const applyRegion = (region: WeatherRegion, message: string) => {
    saveRegionCookie(region);
    setStatus({ kind: "saved", message });
    setIsOpen(false);
    startTransition(() => router.refresh());
  };

  const handleUseCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setStatus({
        kind: "error",
        message: "このブラウザでは現在地を使えません。都道府県を選んでください。",
      });
      return;
    }
    setStatus({ kind: "locating" });
    // ボタンを押したときだけ位置情報を求める。座標はこの関数の中だけで使い、保存しない
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const region = findNearestWeatherRegion({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        if (!region) {
          setStatus({
            kind: "error",
            message:
              "現在地に近い都道府県を見つけられませんでした。都道府県を選んでください。",
          });
          return;
        }
        applyRegion(region, `現在地に近い「${region.name}」に設定しました`);
      },
      (error) => {
        setStatus({ kind: "error", message: getGeolocationErrorMessage(error) });
      },
      GEOLOCATION_OPTIONS,
    );
  };

  const handleSelect = (key: string) => {
    const region = WEATHER_REGIONS.find((candidate) => candidate.key === key);
    if (!region) return;
    applyRegion(region, `「${region.name}」に設定しました`);
  };

  const isBusy = status.kind === "locating" || isRefreshing;
  // 未設定（Cookieなし・不正な値）のあいだは、常に設定欄を開いておく
  const showPicker = isOpen || currentRegionKey === null;

  return (
    <div className="flex flex-col gap-2">
      {!showPicker ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground underline underline-offset-4"
          onClick={() => {
            setStatus({ kind: "idle" });
            setIsOpen(true);
          }}
          disabled={isBusy}
        >
          地域を変更
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          {currentRegionKey === null && (
            <p className="text-sm font-medium">
              お住まいの地域に合わせて、今日の服を提案します
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={handleUseCurrentLocation}
              disabled={isBusy}
            >
              <MapPin aria-hidden="true" />
              {status.kind === "locating" ? "現在地を確認中..." : "現在地から設定"}
            </Button>
            <select
              aria-label="都道府県を選ぶ"
              className="min-h-11 rounded-lg border border-input bg-card px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
              value=""
              onChange={(event) => handleSelect(event.target.value)}
              disabled={isBusy}
            >
              <option value="" disabled>
                都道府県を選ぶ
              </option>
              {WEATHER_REGIONS.map((region) => (
                <option key={region.key} value={region.key}>
                  {region.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            位置情報は、近い都道府県を選ぶためだけにこの端末で使います。緯度・経度は保存・送信しません。
          </p>
          {currentRegionKey !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 w-fit text-muted-foreground"
              onClick={() => setIsOpen(false)}
              disabled={isBusy}
            >
              閉じる
            </Button>
          )}
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className={
          status.kind === "error"
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {isRefreshing
          ? "天気と服の提案を更新しています..."
          : status.kind === "saved" || status.kind === "error"
            ? status.message
            : ""}
      </p>
    </div>
  );
}
