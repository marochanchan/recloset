import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type LoopItemState = {
  isLiked: boolean;
  isOwner: boolean;
};

type LoopItemStateRow = {
  item_id: string;
  is_liked: boolean;
  is_owner: boolean;
};

/**
 * ログインユーザーについて、表示中の公開服の「気になる」状態と
 * 「自分の服かどうか」をまとめて取得する（get_my_loop_item_states、migration 011）。
 * カードごとに呼ばず、表示中のidを1回で渡す。
 * 取得に失敗した場合は空のMapを返す（呼び出し側はボタンを表示しない）。
 */
export async function getMyLoopItemStates(
  supabase: SupabaseServerClient,
  itemIds: string[],
): Promise<Map<string, LoopItemState>> {
  const states = new Map<string, LoopItemState>();
  if (itemIds.length === 0) return states;

  const { data, error } = await supabase.rpc("get_my_loop_item_states", {
    p_item_ids: itemIds,
  });

  if (error) {
    console.error("get_my_loop_item_states error:", error);
    return states;
  }

  for (const row of (data ?? []) as LoopItemStateRow[]) {
    states.set(row.item_id, {
      isLiked: row.is_liked,
      isOwner: row.is_owner,
    });
  }
  return states;
}
