import { isCategoryUnclassified } from "@/lib/clothing-classify";
import {
  getCategoryLabel,
  getSubcategoryLabel,
  PHOTO_ONLY_DISPLAY_LABEL,
  PHOTO_ONLY_TITLE,
} from "@/lib/clothing-options";

/**
 * 画面に出す服の名前（表示のみ。DBのタイトルは変えない）。
 * - 仮タイトル（写真だけ登録）でカテゴリ未分類 → 「未仕分け」
 * - 仮タイトルで仕分け済み → 種類の表示名、なければカテゴリの表示名
 * - 仮タイトルでなければ、そのままタイトル
 */
export function displayClothingTitle(item: {
  title: string;
  category: string;
  subcategory: string | null;
  categoryClassifiedAt: string | null;
}): string {
  if (item.title !== PHOTO_ONLY_TITLE) return item.title;
  if (isCategoryUnclassified(item)) return PHOTO_ONLY_DISPLAY_LABEL;
  return item.subcategory
    ? getSubcategoryLabel(item.subcategory)
    : getCategoryLabel(item.category);
}
