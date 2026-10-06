"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgreSQLのエラーコード
const UNIQUE_VIOLATION = "23505"; // 既に保存済み（主キー重複）
const RLS_VIOLATION = "42501"; // 非公開・自分の服など、INSERTポリシーで拒否

type LikeActionResult = {
  error: string | null;
};

function revalidateLikePaths() {
  // Loop（一覧・詳細）と気になる服一覧の表示を最新の保存状態に揃える
  revalidatePath("/discover", "layout");
  revalidatePath("/protected/likes");
}

/**
 * 公開服を「気になる」に保存する。
 * user_idはクライアントから受け取らず、サーバー側の認証ユーザーを使う。
 * 「公開中」「自分の服ではない」はRLS（migration 011のINSERTポリシー）で強制する。
 * 既に保存済みの場合は成功として扱う（連打・別タブでの操作に対して冪等）。
 */
export async function likeClothingItem(
  itemId: string,
): Promise<LikeActionResult> {
  if (!UUID_PATTERN.test(itemId)) {
    return { error: "対象の服が見つかりません" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログインが必要です" };
  }

  const { error } = await supabase
    .from("clothing_item_likes")
    .insert({ user_id: user.id, clothing_item_id: itemId });

  if (error && error.code !== UNIQUE_VIOLATION) {
    if (error.code === RLS_VIOLATION) {
      return { error: "この服は保存できません" };
    }
    console.error("likeClothingItem: insert error", error);
    return { error: "保存できませんでした。時間をおいてお試しください。" };
  }

  revalidateLikePaths();
  return { error: null };
}

/**
 * 「気になる」を解除する。RLSにより自分の保存しか削除できない。
 * 既に解除済み（削除対象0件）でも成功として扱う。
 */
export async function unlikeClothingItem(
  itemId: string,
): Promise<LikeActionResult> {
  if (!UUID_PATTERN.test(itemId)) {
    return { error: "対象の服が見つかりません" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログインが必要です" };
  }

  const { error } = await supabase
    .from("clothing_item_likes")
    .delete()
    .eq("user_id", user.id)
    .eq("clothing_item_id", itemId);

  if (error) {
    console.error("unlikeClothingItem: delete error", error);
    return { error: "解除できませんでした。時間をおいてお試しください。" };
  }

  revalidateLikePaths();
  return { error: null };
}
