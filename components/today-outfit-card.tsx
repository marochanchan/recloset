import { Button } from "@/components/ui/button";
import { WearTodayButton } from "@/components/wear-today-button";
import { WeatherRegionSetting } from "@/components/weather-region-setting";
import type { OutfitPick, OutfitSuggestion } from "@/lib/outfit-suggestion";
import {
  OPEN_METEO_ATTRIBUTION_URL,
  OPEN_METEO_LICENSE_URL,
  getWeatherLabel,
  type DailyWeather,
} from "@/lib/weather";
import type { WeatherRegion } from "@/lib/weather-regions";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

type TodayWeatherProps = {
  /** 設定した地域（Cookieをサーバーで検証済み。未設定・不正ならnull） */
  region: WeatherRegion | null;
  /** 設定した地域の今日の天気（未設定・取得失敗ならnull） */
  weather: DailyWeather | null;
};

type TodayOutfitCardProps = {
  /** 設定した地域（説明文の地域名に使う） */
  region: WeatherRegion | null;
  suggestion: OutfitSuggestion;
  /** 候補の服ID → 代表画像の署名付きURL */
  imageUrls: Map<string, string>;
};

function WeatherIcon({ code }: { code: number | null }) {
  const className = "h-5 w-5 shrink-0";
  if (code === null) return <Cloud className={className} aria-hidden="true" />;
  if (code <= 1) return <Sun className={className} aria-hidden="true" />;
  if (code === 2) return <CloudSun className={className} aria-hidden="true" />;
  if (code === 45 || code === 48)
    return <CloudFog className={className} aria-hidden="true" />;
  if (code >= 51 && code <= 57)
    return <CloudDrizzle className={className} aria-hidden="true" />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return <CloudSnow className={className} aria-hidden="true" />;
  if (code >= 95)
    return <CloudLightning className={className} aria-hidden="true" />;
  if (code >= 61) return <CloudRain className={className} aria-hidden="true" />;
  return <Cloud className={className} aria-hidden="true" />;
}

function getSlotLabel(pick: OutfitPick): string {
  if (pick.slot === "main") {
    return pick.item.category === "dress" ? "ワンピース" : "トップス";
  }
  return pick.slot === "bottoms" ? "ボトムス" : "アウター";
}

function OutfitPickCard({
  pick,
  imageUrl,
}: {
  pick: OutfitPick;
  imageUrl: string | null;
}) {
  const { item } = pick;
  return (
    // 枠のないカードで写真を主役にする（縦長の生成りの枠にobject-containで収める）
    <div className="flex h-full flex-col gap-2.5">
      <Link
        href={`/protected/items/${item.id}`}
        className="group relative block aspect-[4/5] w-full shrink-0 overflow-hidden rounded-xl bg-photo outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:opacity-90"
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.title}
            fill
            sizes="(min-width: 640px) 240px, 50vw"
            className="object-contain motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
            style={{ objectFit: "contain" }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            画像なし
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium leading-4 backdrop-blur-sm">
          {getSlotLabel(pick)}
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-0.5">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/protected/items/${item.id}`}
            className="line-clamp-2 text-sm font-medium leading-snug hover:underline"
          >
            {item.title}
          </Link>
          {/* 選んだ理由は2行までに収める（季節の理由に「・」を含むため区切りは「／」） */}
          {pick.reasons.length > 0 && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {pick.reasons.join(" ／ ")}
            </p>
          )}
        </div>
        <div className="mt-auto">
          <WearTodayButton
            itemId={item.id}
            alreadyLoggedToday={pick.wornToday}
            variant="plan"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Todayのヘッダーに置く、設定した地域の今日の天気と地域の設定。
 * 地域が未設定なら、設定欄を開いて案内する（候補は月ベースの季節で選ぶ）。
 */
export function TodayWeather({ region, weather }: TodayWeatherProps) {
  const weatherLabel = weather ? getWeatherLabel(weather.weatherCode) : null;

  return (
    <div className="flex flex-col gap-1">
      {region && (
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <WeatherIcon code={weather?.weatherCode ?? null} />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="text-xs text-muted-foreground">{region.name}の天気</p>
            {weather ? (
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                {weatherLabel && <span className="font-medium">{weatherLabel}</span>}
                <span className="tabular-nums">
                  最高{Math.round(weather.maxTemp)}℃ / 最低
                  {Math.round(weather.minTemp)}℃
                </span>
                {weather.precipitationProbability !== null && (
                  <span className="text-muted-foreground">
                    降水{weather.precipitationProbability}%
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                天気を取得できませんでした。今の季節から候補を選んでいます。
              </p>
            )}
          </div>
        </div>
      )}
      {/* 未設定なら設定欄を開いて案内し、設定済みなら「地域を変更」を出す */}
      <WeatherRegionSetting currentRegionKey={region?.key ?? null} />
    </div>
  );
}

/**
 * ログイン中トップの「今日のRe:try」（天気ベースのコーデ候補）。
 * 自分のクローゼットからカテゴリごとに選んだ候補を、写真を主役に表示する。
 * 天気は TodayWeather（ページのヘッダー）に表示する。
 * 服同士の色や形の相性を判断したものではない。
 */
export function TodayOutfitCard({
  region,
  suggestion,
  imageUrls,
}: TodayOutfitCardProps) {
  return (
    <section
      aria-labelledby="today-outfit-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="today-outfit-title" className="text-xl font-bold">
          今日のRe:try
        </h2>
        <p className="text-sm text-muted-foreground">
          {suggestion.basis === "weather" && region
            ? `${region.name}の今日の天気と着用記録から、しばらく出番のない服を中心に選びました。`
            : "今の季節と着用記録から、しばらく出番のない服を中心に選びました。"}
        </p>
      </div>

      {suggestion.picks.length > 0 ? (
        // スマホは画面の端まで横スクロール（2着目の先が少し見える幅）、広い画面は3列
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {suggestion.picks.map((pick) => (
            <li
              key={pick.slot}
              className="w-[46%] min-w-[9.5rem] shrink-0 snap-start sm:w-auto sm:min-w-0"
            >
              <OutfitPickCard
                pick={pick}
                imageUrl={imageUrls.get(pick.item.id) ?? null}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary/60 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {suggestion.basis === "weather"
              ? "今日の気温に合う服がまだ登録されていません"
              : "今の季節に合う服がまだ登録されていません"}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/protected/items/new">服を登録する</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Open-Meteoの出典表示（CC BY 4.0のため必須）。
 * 天気を表示するページの末尾に小さく置く（Todayのコーデ候補の近くでは目立たせない）。
 */
export function WeatherAttribution() {
  return (
    <p className="text-[11px] text-muted-foreground">
      天気データ:{" "}
      <a
        href={OPEN_METEO_ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:text-foreground"
      >
        Weather data by Open-Meteo.com
      </a>{" "}
      (
      <a
        href={OPEN_METEO_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:text-foreground"
      >
        CC BY 4.0
      </a>
      )
    </p>
  );
}
