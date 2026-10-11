-- =========================================
-- migration 012（季節の複数選択）の確認用SQL
-- migrationではない。Supabase SQL Editorで、必要なブロックだけを選んで実行する。
-- どのブロックもデータを変更しない（末尾のロールバックはコメントのまま）。
-- 不整合を見つけても一括で上書きしない。スナップショット（移行時点の値）と
-- 照合し、1件ずつ判断して直す。
-- =========================================

-- -----------------------------------------
-- A. 適用前: 現在の season の分布（移行ルールの前提確認）
--    期待値（2026-10確認）: all 8 / summer 7 / autumn 5 / spring 2 / winter 1 / (null) 1
-- -----------------------------------------
select coalesce(season, '(null)') as season, count(*)
from public.clothing_items
group by 1
order by 2 desc;

select count(*) as unexpected_values
from public.clothing_items
where season is not null
  and season not in ('spring', 'summer', 'autumn', 'winter', 'all');

-- （任意）適用前のバックアップ: 結果をSQL Editorから CSV でダウンロードしておく。
-- migration 012 は season 列を書き換えず、適用時点の値を
-- migration_backup.clothing_items_seasons_012 にも記録する。
select id, season, created_at from public.clothing_items order by id;

-- -----------------------------------------
-- B. 適用後: 列・制約・スナップショットが作られたか
--    期待値: seasons（ARRAY, NOT NULL, default '{}'）/ 制約1件 /
--           スナップショットの件数 = clothing_items の件数（24）
-- -----------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'clothing_items'
  and column_name in ('season', 'seasons');

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.clothing_items'::regclass
  and conname = 'clothing_items_seasons_values';

select
  (select count(*) from public.clothing_items) as items,
  (select count(*) from migration_backup.clothing_items_seasons_012) as snapshot_rows;

-- スナップショットのアクセス権（すべて false が期待値）
--   スキーマのUSAGEがなければ、表の権限に関係なくアクセスできない
select
  has_schema_privilege('anon', 'migration_backup', 'usage') as anon_schema_usage,
  has_schema_privilege('authenticated', 'migration_backup', 'usage') as authenticated_schema_usage,
  has_table_privilege('anon', 'migration_backup.clothing_items_seasons_012', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'migration_backup.clothing_items_seasons_012', 'select') as authenticated_can_select;

-- スナップショット表のRLS（rowsecurity = true が期待値）
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'migration_backup';

-- API（PostgREST）が公開しているスキーマ（migration_backup が含まれないことが期待値）
--   authenticator ロールの pgrst.db_schemas に公開スキーマが設定されている。
--   値が出ない場合は、Supabaseダッシュボードの
--   Project Settings → Data API → Exposed schemas で確認する
--   （既定は public, graphql_public）。
select rolname, rolconfig
from pg_roles
where rolname = 'authenticator';

-- スナップショットと現在のデータの照合
--   新アプリへの切り替え前（push前）は、すべて 0 が期待値
--   （push後は、新アプリでの登録・編集の分だけ差が出る。差の中身はDで確認する）
select
  count(*) filter (where b.id is null) as items_not_in_snapshot,
  count(*) filter (where ci.id is null) as snapshot_rows_without_item,
  count(*) filter (where ci.id is not null and b.id is not null
                     and ci.season is distinct from b.season) as season_changed,
  count(*) filter (where ci.id is not null and b.id is not null
                     and ci.seasons is distinct from b.seasons) as seasons_changed
from public.clothing_items ci
full join migration_backup.clothing_items_seasons_012 b on b.id = ci.id;

-- -----------------------------------------
-- C. 適用後: 移行結果（season ごとの seasons）
--    期待値: all → {spring,summer,autumn,winter} 8 / 単一季節 → その1つ / null → {} 1
-- -----------------------------------------
select coalesce(season, '(null)') as season, seasons, count(*)
from public.clothing_items
group by 1, 2
order by 1, 2;

-- -----------------------------------------
-- D. 整合チェック（新アプリへの切り替え後に実行。0件なら整合）
--
-- 判定: 新アプリは保存のたびに season = 「seasons から導いた値」を書く
--   （4季節→'all'、1季節→その値、0季節・2〜3季節→null）。
--   よって season が「seasons から導いた値」と一致しない行だけが不整合。
--   - 正常な複数季節（season=null・seasons 2〜3個）は一致するので検出しない
--   - 旧アプリでの新規登録（季節あり）・季節の変更・未設定への変更は検出する
--   - 旧アプリでの新規登録（季節なし）は season=null・seasons={} で一致する
--     （実際に整合しているため検出しない）
--
-- このチェックで検出できないケース（情報が残らないため）:
--   1. 新アプリで2〜3季節にした服を、旧アプリで開いて季節を変えずに保存した場合。
--      旧アプリには「未選択」と表示され season=null のまま保存されるため、
--      変化が残らない（seasons は保持されるので、データは失われない）。
--   2. 旧アプリで、すでに整合している値と同じ季節を選び直して保存した場合
--      （値が変わらないため、検出の必要もない）。
--   3. 旧アプリで季節なしの服を新規登録した場合（season=null・seasons={} で
--      実際に整合している。本人が季節を入れ忘れた可能性は判別できない）。
--
-- hint は原因の手がかり（スナップショット＝移行時点の値との比較）。
-- 修正は1件ずつ判断する（seasonを正として一括で上書きしない）。
-- -----------------------------------------
with current_items as (
  select
    ci.id,
    ci.title,
    ci.created_at,
    ci.season,
    ci.seasons,
    case (select count(distinct s) from unnest(ci.seasons) as s)
      when 4 then 'all'
      when 1 then ci.seasons[1]
      else null
    end as expected_season
  from public.clothing_items ci
)
select
  c.id,
  c.title,
  c.created_at,
  c.season,
  c.seasons,
  c.expected_season,
  b.season as snapshot_season,
  b.seasons as snapshot_seasons,
  case
    when b.id is null
      then '移行後に登録された服（旧アプリで登録した可能性）'
    when c.season is distinct from b.season and c.seasons = b.seasons
      then '移行後に season だけが変わった（旧アプリで季節を変更した可能性）'
    else '要確認（スナップショットと現在値を見比べる）'
  end as hint
from current_items c
left join migration_backup.clothing_items_seasons_012 b on b.id = c.id
where c.season is distinct from c.expected_season
order by c.created_at;

-- D-2. seasons の形式チェック（0件が期待値）
--   新アプリは seasons を「重複なし・春→夏→秋→冬の順」に正規化して保存する。
--   重複・順序の乱れは、アプリ以外（SQLでの直接編集など）で書かれた可能性がある。
--   正常な2〜3季節のデータ（例: {spring,summer,autumn}）は検出しない。
select
  ci.id,
  ci.title,
  ci.season,
  ci.seasons,
  array(
    select s
    from unnest(array['spring', 'summer', 'autumn', 'winter']::text[])
      with ordinality as v(s, ord)
    where s = any(ci.seasons)
    order by ord
  ) as normalized_seasons,
  case
    when cardinality(ci.seasons)
           <> (select count(distinct s) from unnest(ci.seasons) as s)
      then '重複がある'
    else '並び順が 春→夏→秋→冬 ではない'
  end as problem
from public.clothing_items ci
where ci.seasons is distinct from array(
  select s
  from unnest(array['spring', 'summer', 'autumn', 'winter']::text[])
    with ordinality as v(s, ord)
  where s = any(ci.seasons)
  order by ord
);

-- 参考: 状態ごとの件数（整合している行の内訳）
select
  count(*) filter (where cardinality(seasons) = 0) as unset_items,
  count(*) filter (where cardinality(seasons) = 1) as single_season_items,
  count(*) filter (where cardinality(seasons) in (2, 3)) as multi_season_items,
  count(*) filter (where cardinality(seasons) = 4) as all_season_items
from public.clothing_items;

-- -----------------------------------------
-- E. 適用後: 公開RPCの権限（期待値どおりか）
--    list_public / get_public: anon=true, authenticated=true
--    list_my_liked:            anon=false, authenticated=true
--    3つとも security_definer=true, config={search_path=""}
-- -----------------------------------------
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  p.proconfig as config,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'list_public_clothing_items',
    'get_public_clothing_item',
    'list_my_liked_public_clothing_items'
  );

-- 公開一覧RPCが season と seasons を返すか（公開中の服だけが返る）
select id, title, season, seasons
from public.list_public_clothing_items(5);

-- =========================================
-- F. ロールバック
--    通常は実行しない。まずアプリだけを旧バージョンへ戻す（DBは012のままでよい）。
--    DBまで戻す場合は supabase/sql/012_seasons_rollback.sql の手順に従う
--    （RPC 3つを旧定義へ戻してから seasons 列を削除する。誤実行防止の確認付き）。
-- =========================================
