import { aggregatePartners, layoutRadialLines, type PairMonthRow } from "@/lib/outfits/relations";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import Image from "next/image";
import Link from "next/link";

const SIZE = 340; // 描く範囲の一辺（中心 170）
const CENTER_RADIUS = 28;
const EMPTY_COPY = "まだ一緒に着た記録がありません。着画を撮ると、ここに線が伸びます";

// よく合わせる服：真ん中の服から、一緒に着た服へ線を伸ばす（回数が多いほど近く・太く・大きく）
export async function RelationLines({ itemId }: { itemId: string }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  const { data: rows, error } = await supabase
    .from("item_pair_monthly_stats")
    .select("item_a, item_b, month, outfit_count, together_days, last_worn_on")
    .or(`item_a.eq.${itemId},item_b.eq.${itemId}`);

  if (error) {
    console.error("relation lines: fetch stats error", error.code);
    return <p className="text-sm text-muted-foreground">{EMPTY_COPY}</p>;
  }

  const partners = aggregatePartners((rows ?? []) as PairMonthRow[], itemId);
  const lines = layoutRadialLines(partners, { max: 8, innerRadius: 70, outerRadius: 130 });
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{EMPTY_COPY}</p>;
  }

  // 表示する相手の服と、いちばん前の写真（RLS で本人の服だけが返る）
  const { data: items, error: itemsError } = await supabase
    .from("clothing_items")
    .select("id, title, clothing_images(image_path, sort_order)")
    .in("id", lines.map((l) => l.itemId))
    .order("sort_order", { referencedTable: "clothing_images" });
  if (itemsError) {
    console.error("relation lines: fetch items error", itemsError.code);
  }
  const itemById = new Map((items ?? []).map((item) => [item.id, item]));

  const paths = (items ?? [])
    .map((item) => item.clothing_images[0]?.image_path)
    .filter((p): p is string => Boolean(p));
  const urlByPath = await getPrivateSignedImageUrls(supabase, userId, paths, "relation lines");

  // 相手の服が見つからない（手放して消えた等）線は描かない
  const shown = lines.filter((line) => itemById.has(line.itemId));
  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">{EMPTY_COPY}</p>;
  }
  const half = SIZE / 2;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg
        viewBox={`${-half} ${-half} ${SIZE} ${SIZE}`}
        className="absolute inset-0 h-full w-full text-primary/50"
        aria-hidden="true"
      >
        {shown.map((line) => (
          <line
            key={line.itemId}
            x1={0}
            y1={0}
            x2={line.x}
            y2={line.y}
            stroke="currentColor"
            strokeWidth={line.strokeWidth}
            strokeLinecap="round"
          />
        ))}
        <circle r={CENTER_RADIUS} className="fill-primary/20 stroke-primary" strokeWidth={2} />
      </svg>

      {shown.map((line) => {
        const partner = itemById.get(line.itemId)!;
        const path = partner.clothing_images[0]?.image_path;
        const url = path ? urlByPath.get(path) : undefined;
        const diameter = line.nodeRadius * 2;
        return (
          <Link
            key={line.itemId}
            href={`/protected/items/${line.itemId}`}
            aria-label={partner.title}
            className="absolute flex items-center justify-center overflow-hidden rounded-full border-2 border-card bg-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              width: `${(diameter / SIZE) * 100}%`,
              height: `${(diameter / SIZE) * 100}%`,
              left: `${((half + line.x - line.nodeRadius) / SIZE) * 100}%`,
              top: `${((half + line.y - line.nodeRadius) / SIZE) * 100}%`,
            }}
          >
            {url ? (
              <Image
                src={url}
                alt=""
                fill
                sizes="60px"
                className="object-cover"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <span className="sr-only">{partner.title}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
