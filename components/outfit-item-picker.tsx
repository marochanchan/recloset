"use client";

import { DoodleHanger } from "@/components/doodle-icons";
import { CATEGORY_OPTIONS, getCategoryLabel } from "@/lib/clothing-options";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

export type PickerItem = {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
};

type OutfitItemPickerProps = {
  items: PickerItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

// しまっていない服をカテゴリーのタブで出し、複数選べる。選んだ服は別のタブにあっても残る
export function OutfitItemPicker({ items, selectedIds, onChange }: OutfitItemPickerProps) {
  const tabs = CATEGORY_OPTIONS.filter((option) =>
    items.some((item) => item.category === option.value),
  );
  // 想定外のカテゴリーの服も落とさないよう、末尾の「その他」にまとめる
  const knownValues: readonly string[] = CATEGORY_OPTIONS.map((o) => o.value);
  const hasUnknown = items.some((item) => !knownValues.includes(item.category));
  const [activeTab, setActiveTab] = useState<string>(
    tabs[0]?.value ?? (hasUnknown ? "other" : ""),
  );

  if (items.length === 0) {
    return (
      <p className="rounded-2xl bg-secondary/60 px-4 py-6 text-center text-sm text-muted-foreground">
        まだ服が登録されていません。服を登録すると、ここから選べます
      </p>
    );
  }

  const visible = items.filter((item) =>
    activeTab === "other"
      ? item.category === "other" || !knownValues.includes(item.category)
      : item.category === activeTab,
  );
  const tabList = hasUnknown && !tabs.some((t) => t.value === "other")
    ? [...tabs, { value: "other", label: getCategoryLabel("other") }]
    : tabs;

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="カテゴリー" className="flex gap-1.5 overflow-x-auto pb-1">
        {tabList.map((tab) => {
          const selectedCount = items.filter(
            (item) =>
              selectedIds.includes(item.id) &&
              (tab.value === "other"
                ? item.category === "other" || !knownValues.includes(item.category)
                : item.category === tab.value),
          ).length;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "min-h-9 shrink-0 rounded-full px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeTab === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {tab.label}
              {selectedCount > 0 && ` (${selectedCount})`}
            </button>
          );
        })}
      </div>

      <ul role="tabpanel" className="grid grid-cols-3 gap-2">
        {visible.map((item) => {
          const selected = selectedIds.includes(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(item.id)}
                className={cn(
                  "relative flex w-full flex-col gap-1 rounded-2xl p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "bg-primary/10 ring-2 ring-primary" : "",
                )}
              >
                <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-photo">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="33vw"
                      className="object-contain"
                      style={{ objectFit: "contain" }}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-primary/50">
                      <DoodleHanger size={28} />
                    </span>
                  )}
                  {selected && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="line-clamp-1 px-0.5 text-xs">{item.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
