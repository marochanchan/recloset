"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORY_OPTIONS, SEASON_OPTIONS } from "@/lib/clothing-options";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const selectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
);

const MAX_IMAGE_COUNT = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type RegisteredItemState = {
  id: string;
  totalImages: number;
  failedImages: number;
};

export function ClothingItemForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [season, setSeason] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [registeredItem, setRegisteredItem] =
    useState<RegisteredItemState | null>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageFiles(e.target.files ? Array.from(e.target.files) : []);
  };

  const resetForm = () => {
    setTitle("");
    setBrand("");
    setCategory("");
    setSeason("");
    setPurchaseDate("");
    setPurchasePrice("");
    setFavorite(false);
    setImageFiles([]);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (imageFiles.length > MAX_IMAGE_COUNT) {
      setError(`画像は${MAX_IMAGE_COUNT}枚までです`);
      return;
    }
    if (imageFiles.some((file) => !ALLOWED_IMAGE_TYPES.includes(file.type as typeof ALLOWED_IMAGE_TYPES[number]))) {
      setError("対応していない画像形式が含まれています（JPEG/PNG/WebPのみ）");
      return;
    }
    if (imageFiles.some((file) => file.size > MAX_IMAGE_SIZE)) {
      setError("10MBを超える画像が含まれています");
      return;
    }

    const supabase = createClient();
    setIsLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("ログイン情報が確認できませんでした");

      const itemId = crypto.randomUUID();

      const { error: insertError } = await supabase
        .from("clothing_items")
        .insert({
          id: itemId,
          user_id: user.id,
          title,
          brand: brand || null,
          category,
          season: season || null,
          purchase_date: purchaseDate || null,
          purchase_price: purchasePrice === "" ? null : Number(purchasePrice),
          favorite,
        });
      if (insertError) throw insertError;

      if (imageFiles.length === 0) {
        resetForm();
        router.push("/protected/items");
        return;
      }

      let failedImages = 0;
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        try {
          const ext = MIME_TO_EXTENSION[file.type];
          const path = `${user.id}/${itemId}/${crypto.randomUUID()}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("clothing-images")
            .upload(path, file, { contentType: file.type });
          if (uploadError) throw uploadError;

          const { error: imageInsertError } = await supabase
            .from("clothing_images")
            .insert({
              clothing_item_id: itemId,
              image_path: path,
              sort_order: i,
            });
          if (imageInsertError) {
            const { error: removeError } = await supabase.storage
              .from("clothing-images")
              .remove([path]);
            if (removeError) {
              console.error("clothing image cleanup failed:", removeError);
            }
            throw imageInsertError;
          }
        } catch (imageError: unknown) {
          console.error("clothing image registration failed:", imageError);
          failedImages++;
        }
      }

      if (failedImages > 0) {
        setRegisteredItem({
          id: itemId,
          totalImages: imageFiles.length,
          failedImages,
        });
      } else {
        resetForm();
        router.push("/protected/items");
      }
    } catch (error: unknown) {
      console.error("clothing item registration failed:", error);
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message)
          : "服の登録に失敗しました";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (registeredItem) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">服を登録</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-yellow-600">
              服は登録されましたが、{registeredItem.totalImages}枚中
              {registeredItem.failedImages}枚の画像登録に失敗しました
            </p>
            <div className="flex flex-col gap-2 text-sm">
              <Link
                href={`/protected/items/${registeredItem.id}`}
                className="underline underline-offset-4"
              >
                登録済みの服を見る
              </Link>
              <Link
                href="/protected/items"
                className="underline underline-offset-4"
              >
                クローゼット一覧へ戻る
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">服を登録</CardTitle>
          <CardDescription>クローゼットに新しいアイテムを追加します</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="title">タイトル</Label>
                <Input
                  id="title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="brand">ブランド</Label>
                <Input
                  id="brand"
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="category">カテゴリー</Label>
                <select
                  id="category"
                  required
                  className={selectClassName}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="season">シーズン</Label>
                <select
                  id="season"
                  className={selectClassName}
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                >
                  <option value="">未選択</option>
                  {SEASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="purchase-date">購入日</Label>
                <Input
                  id="purchase-date"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="purchase-price">購入価格</Label>
                <Input
                  id="purchase-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="images">画像（任意・最大{MAX_IMAGE_COUNT}枚）</Label>
                <input
                  id="images"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImagesChange}
                  className={selectClassName}
                />
                {imageFiles.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {imageFiles.length}枚選択中
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="favorite"
                  checked={favorite}
                  onCheckedChange={(checked) => setFavorite(checked === true)}
                />
                <Label htmlFor="favorite">お気に入りに登録する</Label>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "登録中..." : "登録する"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
