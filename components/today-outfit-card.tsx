import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WearTodayButton } from "@/components/wear-today-button";
import type { OutfitPick, OutfitSuggestion } from "@/lib/outfit-suggestion";
import {
  OPEN_METEO_ATTRIBUTION_URL,
  OPEN_METEO_LICENSE_URL,
  WEATHER_LOCATION,
  getWeatherLabel,
  type DailyWeather,
} from "@/lib/weather";
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

type TodayOutfitCardProps = {
  weather: DailyWeather | null;
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
    <Card className="flex gap-3 overflow-hidden p-3 sm:flex-col">
      <Link
        href={`/protected/items/${item.id}`}
        className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md bg-muted sm:aspect-square sm:h-auto sm:w-full"
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.title}
            fill
            sizes="(min-width: 640px) 240px, 96px"
            className="object-contain"
            style={{ objectFit: "contain" }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            画像なし
          </div>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Badge variant="secondary" className="w-fit">
            {getSlotLabel(pick)}
          </Badge>
          <Link
            href={`/protected/items/${item.id}`}
            className="line-clamp-2 text-sm font-medium hover:underline"
          >
            {item.title}
          </Link>
          {pick.reasons.length > 0 && (
            <ul className="flex flex-col text-xs text-muted-foreground">
              {pick.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-auto">
          <WearTodayButton
            itemId={item.id}
            alreadyLoggedToday={pick.wornToday}
            variant="compact"
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * ログイン中トップの「今日のコーデ候補」。
 * 横浜の今日の天気と、自分のクローゼットからカテゴリごとに選んだ候補を表示する。
 * 服同士の色や形の相性を判断したものではない。
 */
export function TodayOutfitCard({
  weather,
  suggestion,
  imageUrls,
}: TodayOutfitCardProps) {
  const weatherLabel = weather ? getWeatherLabel(weather.weatherCode) : null;

  return (
    <section
      aria-labelledby="today-outfit-title"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="today-outfit-title" className="text-lg font-semibold">
          今日のコーデ候補
        </h2>
        <p className="text-sm text-muted-foreground">
          {suggestion.basis === "weather"
            ? "横浜の今日の天気に合わせて、クローゼットから1着ずつ選びました。"
            : "今の季節に合わせて、クローゼットから1着ずつ選びました。"}
        </p>
      </div>

      <div className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
        <p className="text-xs text-muted-foreground">
          {WEATHER_LOCATION.name}の今日の天気
        </p>
        {weather ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <WeatherIcon code={weather.weatherCode} />
            {weatherLabel && <span>{weatherLabel}</span>}
            <span>
              最高{Math.round(weather.maxTemp)}℃ / 最低
              {Math.round(weather.minTemp)}℃
            </span>
            {weather.precipitationProbability !== null && (
              <span className="text-muted-foreground">
                ・降水{weather.precipitationProbability}%
              </span>
            )}
          </p>
        ) : (
          <p className="text-muted-foreground">
            天気を取得できませんでした。今の季節から候補を選んでいます。
          </p>
        )}
      </div>

      {suggestion.picks.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {suggestion.picks.map((pick) => (
            <OutfitPickCard
              key={pick.slot}
              pick={pick}
              imageUrl={imageUrls.get(pick.item.id) ?? null}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
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

      {weather && (
        <p className="text-xs text-muted-foreground">
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
      )}
    </section>
  );
}
