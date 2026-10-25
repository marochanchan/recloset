-- =========================================
-- Re:Closet: 着用の書き込みを RPC だけにする権限の締め付けと、月ごとサマリーの初期集計
--
-- 目的:
-- - 着用記録（wear_logs）は RPC（record_wear_today など）だけが書く。
--   authenticated から wear_logs の insert・update・delete を取り上げる
-- - wear_count / last_worn_at / archived_at は派生値・RPC の管理する値なので、
--   authenticated が clothing_items に直接書けないようにする（列ごとの grant）
-- - 既存データの月ごとサマリーと wear_count / last_worn_at を、残っている記録から作り直す
--
-- 削除の権限は今のまま残す（仕様書 6.3 章）。
--   - 登録失敗の取り消しなど、コーデに入っていない服の delete は今までどおりできる
--   - コーデに入っている服は外部キー（outfit_items）で消せない（hard_delete_item を使う）
--   - 服を消すと、その服の wear_logs・item_monthly_stats は cascade で一緒に消える
--
-- 適用の順番（本番）:
--   020〜023 を先に適用し、actions.ts を RPC に切り替えたコードを本番で動かしてから、
--   このファイルを適用する（先に適用すると、今の直接の insert・update が失敗するため）
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する（begin〜commit の1トランザクション）
-- =========================================
begin;

-- -----------------------------------------
-- 1. wear_logs: 書き込みはすべて RPC（security definer）に任せる。select は残す
-- -----------------------------------------
revoke insert, update, delete on public.wear_logs from authenticated;

-- -----------------------------------------
-- 2. clothing_items: 列ごとの grant にする
--
-- 今後 clothing_items に列を足すときは、ここと同じ grant を足す
-- （足さないと、アプリからその列を insert・update できない）。
--   insert: wear_count・last_worn_at・archived_at 以外のすべての列（id・user_id は登録処理が指定する）
--   update: 上に加えて id・user_id・created_at も除く
-- 列の一覧は information_schema.columns から作る（001 以降に足された列を取りこぼさないため）
-- -----------------------------------------
revoke insert, update on public.clothing_items from authenticated;

do $$
declare
  v_insert_cols text;
  v_update_cols text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into v_insert_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clothing_items'
     and column_name not in ('wear_count', 'last_worn_at', 'archived_at');

  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into v_update_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clothing_items'
     and column_name not in ('id', 'user_id', 'created_at', 'wear_count', 'last_worn_at', 'archived_at');

  execute format('grant insert (%s) on public.clothing_items to authenticated', v_insert_cols);
  execute format('grant update (%s) on public.clothing_items to authenticated', v_update_cols);
end;
$$;

-- -----------------------------------------
-- 3. 初期集計
-- 先に、wear_count か last_worn_at が記録と違っていた服の件数を出す（SQL Editor の Messages に出る）。
-- そのあと、持ち主ごとに rebuild_all_stats（中でユーザー単位のロックを取る）で作り直す。
-- 2着の関係とコーデのサマリーは、既存データからは推測して作らない（着用記録からは推測せず、確定済みコーデからだけ作る）
-- -----------------------------------------
do $$
declare
  v_mismatch integer;
  u uuid;
begin
  select count(*) into v_mismatch
    from public.clothing_items ci
   where ci.wear_count is distinct from
           (select count(*) from public.wear_logs wl where wl.clothing_item_id = ci.id)
      or ci.last_worn_at is distinct from
           (select max(wl.worn_at) from public.wear_logs wl where wl.clothing_item_id = ci.id);
  raise notice '024 backfill: wear_count / last_worn_at が記録と違っていた服: % 件', v_mismatch;

  for u in select distinct user_id from public.clothing_items loop
    perform public.rebuild_all_stats(u);
  end loop;
end;
$$;

commit;
