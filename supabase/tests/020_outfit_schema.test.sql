-- =========================================
-- migration 020（コーデのスキーマ）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 前提: 020_before_setup.sql → Supabase既定の権限のまね → 020 の順に適用済み。
-- 確認と準備は postgres で行い、操作は authenticated / anon で行う。
-- 全体を begin〜rollback で包む（ユーザー C のデータには触らない）
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set A_ITEM1 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set A_ITEM2 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set A_ITEM3 'a3a3a3a3-0000-4000-8000-0000000000a3'
\set B_ITEM 'b1b1b1b1-0000-4000-8000-0000000000b1'
\set B_ITEM2 'b2b2b2b2-0000-4000-8000-0000000000b2'
\set A_LOG1 'a1a10001-0000-4000-8000-000000000001'
\set A_LOG3 'a1a10003-0000-4000-8000-000000000003'
\set A_OUTFIT1 'a0a0a0a1-0000-4000-8000-0000000000e1'
\set A_OUTFIT2 'a0a0a0a2-0000-4000-8000-0000000000e2'
\set B_OUTFIT 'b0b0b0b1-0000-4000-8000-0000000000e3'
\set A_MEDIA1 'a0a0a0a1-0000-4000-8000-0000000000f1'
\set A_MEDIA2 'a0a0a0a2-0000-4000-8000-0000000000f2'
\set B_MEDIA 'b0b0b0b1-0000-4000-8000-0000000000f3'

begin;

-- -----------------------------------------
-- 準備（postgres）
-- -----------------------------------------
-- 024 の初期集計で作られた item_monthly_stats は、このテストが数を決めて入れ直すため消す
-- （rollback で戻る）
delete from public.item_monthly_stats;

insert into public.clothing_items (id, user_id, title, category)
values (:'B_ITEM2', :'B', 'Bの服2', 'bottoms');

insert into public.outfits (id, user_id, worn_on, source)
values
  (:'A_OUTFIT1', :'A', '2026-10-05', 'upload'),
  (:'A_OUTFIT2', :'A', '2026-10-06', 'upload'),
  (:'B_OUTFIT', :'B', '2026-10-05', 'upload');
insert into public.outfit_media (id, user_id, outfit_id, kind, provider, provider_asset_id)
values
  (:'A_MEDIA1', :'A', :'A_OUTFIT1', 'photo', 'cf_images', 'asset-a1'),
  (:'A_MEDIA2', :'A', :'A_OUTFIT2', 'photo', 'cf_images', 'asset-a2'),
  (:'B_MEDIA', :'B', :'B_OUTFIT', 'photo', 'cf_images', 'asset-b1');
insert into public.outfit_items (outfit_id, item_id, user_id)
values
  (:'A_OUTFIT1', :'A_ITEM1', :'A'),
  (:'B_OUTFIT', :'B_ITEM', :'B');
insert into public.item_monthly_stats (user_id, item_id, month)
values (:'A', :'A_ITEM1', '2026-10-01'), (:'B', :'B_ITEM', '2026-10-01');
insert into public.item_pair_monthly_stats (user_id, item_a, item_b, month)
values (:'A', :'A_ITEM1', :'A_ITEM2', '2026-10-01'), (:'B', :'B_ITEM', :'B_ITEM2', '2026-10-01');
insert into public.outfit_combo_monthly_stats (user_id, combo_key, item_ids, month)
values
  (:'A', 'k-a', array[:'A_ITEM1', :'A_ITEM2']::uuid[], '2026-10-01'),
  (:'B', 'k-b', array[:'B_ITEM', :'B_ITEM2']::uuid[], '2026-10-01');
insert into public.media_deletion_queue (user_id, provider, provider_asset_id)
values (:'A', 'cf_images', 'queued-a');

-- -----------------------------------------
-- 1. 既存の着用記録の source
-- -----------------------------------------
select test.assert(current_user = 'postgres', 'postgres で確認する');
select test.assert(
  (select count(*) from public.wear_logs) > 0
    and not exists (select 1 from public.wear_logs where source <> 'wear_today'),
  '既存の着用記録の source はすべて wear_today');

-- -----------------------------------------
-- 2. A として読む（RLS）
-- -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', :'A', true);
select test.assert(current_user = 'authenticated' and auth.uid() = :'A'::uuid, 'A として操作する');
select test.assert(
  (select count(*) from public.outfits where user_id = :'A') = 2
    and (select count(*) from public.outfits where user_id = :'B') = 0
    and (select count(*) from public.outfits) = 2,
  'A は自分の outfits を読め、B の outfits は0件');
select test.assert(
  (select count(*) from public.outfit_media where user_id = :'A') = 2
    and (select count(*) from public.outfit_media) = 2,
  'outfit_media は A の分だけ見える');
select test.assert(
  (select count(*) from public.outfit_items where user_id = :'A') = 1
    and (select count(*) from public.outfit_items) = 1,
  'outfit_items は A の分だけ見える');
select test.assert(
  (select count(*) from public.item_monthly_stats) = 1
    and (select count(*) from public.item_pair_monthly_stats) = 1
    and (select count(*) from public.outfit_combo_monthly_stats) = 1,
  'サマリー3つは A の分だけ見える');

-- -----------------------------------------
-- 3. authenticated は書けない・キューは読めない
-- -----------------------------------------
select test.assert(current_user = 'authenticated' and auth.uid() = :'A'::uuid, 'A として書き込みを試す');
select test.expect_denied(
  format('insert into public.outfits (user_id, worn_on, source) values (%L, %L, %L)', :'A', '2026-10-07', 'upload'),
  'authenticated は outfits に insert できない');
select test.expect_denied(
  format('insert into public.outfit_items (outfit_id, item_id, user_id) values (%L, %L, %L)', :'A_OUTFIT1', :'A_ITEM2', :'A'),
  'authenticated は outfit_items に insert できない');
select test.expect_denied(
  format('insert into public.outfit_media (user_id, outfit_id, kind, provider, provider_asset_id) values (%L, %L, %L, %L, %L)',
         :'A', :'A_OUTFIT1', 'photo', 'cf_images', 'x'),
  'authenticated は outfit_media に insert できない');
select test.expect_denied(
  format('insert into public.item_monthly_stats (user_id, item_id, month) values (%L, %L, %L)', :'A', :'A_ITEM2', '2026-10-01'),
  'authenticated は item_monthly_stats に insert できない');
select test.expect_denied(
  format('insert into public.item_pair_monthly_stats (user_id, item_a, item_b, month) values (%L, %L, %L, %L)',
         :'A', :'A_ITEM1', :'A_ITEM3', '2026-10-01'),
  'authenticated は item_pair_monthly_stats に insert できない');
select test.expect_denied(
  format('insert into public.outfit_combo_monthly_stats (user_id, combo_key, item_ids, month) values (%L, %L, %L, %L)',
         :'A', 'k2', '{}', '2026-10-01'),
  'authenticated は outfit_combo_monthly_stats に insert できない');
select test.expect_denied('select count(*) from public.media_deletion_queue',
  'authenticated は media_deletion_queue を select できない');

-- -----------------------------------------
-- 4. anon は何も読めない
-- -----------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select test.assert(current_user = 'anon' and auth.uid() is null, 'anon として操作する');
select test.expect_denied(format('select count(*) from public.%I', t), 'anon は ' || t || ' を select できない')
from unnest(array['outfits', 'outfit_items', 'outfit_media', 'item_monthly_stats',
                  'item_pair_monthly_stats', 'outfit_combo_monthly_stats', 'media_deletion_queue']) as t;
reset role;

-- -----------------------------------------
-- 5. 外部キー（postgres で実行。所有者の一致を外部キーが守る）
-- -----------------------------------------
select test.assert(current_user = 'postgres', 'postgres で外部キーを確かめる');
select test.expect_error(
  format('insert into public.outfit_items (outfit_id, item_id, user_id) values (%L, %L, %L)', :'A_OUTFIT1', :'B_ITEM', :'A'),
  'violates foreign key constraint',
  'B の服を A のコーデの outfit_items に入れると外部キーで失敗する');
select test.expect_error(
  format('insert into public.outfit_items (outfit_id, item_id, user_id, wear_log_id) values (%L, %L, %L, %L)',
         :'A_OUTFIT2', :'A_ITEM1', :'A', :'A_LOG3'),
  'violates foreign key constraint',
  'A の服 T の行に A の別の服 D の着用記録を入れると外部キーで失敗する');

-- 着用記録を消すと wear_log_id だけが null になる
update public.outfit_items set wear_log_id = :'A_LOG1'
 where outfit_id = :'A_OUTFIT1' and item_id = :'A_ITEM1';
delete from public.wear_logs where id = :'A_LOG1';
select test.assert(
  exists (select 1 from public.outfit_items
           where outfit_id = :'A_OUTFIT1' and item_id = :'A_ITEM1' and wear_log_id is null),
  '着用記録を消すと outfit_items の wear_log_id だけが null になり、行は残る');

-- 服の delete: コーデに入っていれば restrict、入っていなければ通る
select test.expect_error(
  format('delete from public.clothing_items where id = %L', :'A_ITEM1'),
  'violates foreign key constraint',
  'コーデに入っている服の delete は restrict で失敗する');
delete from public.clothing_items where id = :'A_ITEM3';
select test.assert(
  not exists (select 1 from public.clothing_items where id = :'A_ITEM3'),
  'コーデに入っていない服の delete は通る');

-- analysis_media_id
select test.expect_error(
  format('update public.outfits set analysis_media_id = %L where id = %L', :'A_MEDIA2', :'A_OUTFIT1'),
  'violates foreign key constraint',
  '別のコーデのメディアを analysis_media_id にすると外部キーで失敗する');
update public.outfits set analysis_media_id = :'A_MEDIA1' where id = :'A_OUTFIT1';
delete from public.outfit_media where id = :'A_MEDIA1';
select test.assert(
  exists (select 1 from public.outfits where id = :'A_OUTFIT1' and analysis_media_id is null),
  'メディアを消すと analysis_media_id だけが null になり、outfits.id は残る');

-- -----------------------------------------
-- 6. check 制約
-- -----------------------------------------
select test.expect_error(
  format('insert into public.item_monthly_stats (user_id, item_id, month) values (%L, %L, %L)', :'A', :'A_ITEM2', '2026-10-15'),
  'item_monthly_stats_month_first_day',
  'month が月の1日でないサマリーは check で失敗する');
select test.expect_error(
  format('update public.clothing_items set archived_at = now(), is_public = true, published_at = now() where id = %L', :'A_ITEM2'),
  'clothing_items_archived_not_public',
  'archived_at のある服を is_public = true にすると check で失敗する');

-- 列挙値の check（正しい値は準備の insert で通っている）
select test.assert(current_user = 'postgres', 'postgres で列挙値の check を確かめる');
select test.expect_error(
  format('insert into public.outfits (user_id, worn_on, source) values (%L, %L, %L)', :'A', '2026-10-08', 'wear_today'),
  'outfits_source_check', 'outfits.source の範囲外の値は check で失敗する');
select test.expect_error(
  format('insert into public.outfits (user_id, worn_on, source, status) values (%L, %L, %L, %L)', :'A', '2026-10-08', 'upload', 'done'),
  'outfits_status_check', 'outfits.status の範囲外の値は check で失敗する');
select test.expect_error(
  format('insert into public.outfit_media (user_id, outfit_id, kind, provider, provider_asset_id) values (%L, %L, %L, %L, %L)', :'A', :'A_OUTFIT2', 'gif', 'cf_images', 'bad-kind'),
  'outfit_media_kind_check', 'outfit_media.kind の範囲外の値は check で失敗する');
select test.expect_error(
  format('insert into public.outfit_media (user_id, outfit_id, kind, provider, provider_asset_id) values (%L, %L, %L, %L, %L)', :'A', :'A_OUTFIT2', 'photo', 'cloudflare', 'bad-provider'),
  'outfit_media_provider_check', 'outfit_media.provider の範囲外の値は check で失敗する');
select test.expect_error(
  format('insert into public.outfit_media (user_id, outfit_id, kind, provider, provider_asset_id, status) values (%L, %L, %L, %L, %L, %L)', :'A', :'A_OUTFIT2', 'photo', 'cf_images', 'bad-status', 'done'),
  'outfit_media_status_check', 'outfit_media.status の範囲外の値は check で失敗する');
select test.expect_error(
  format('insert into public.outfit_items (outfit_id, item_id, user_id, source) values (%L, %L, %L, %L)', :'A_OUTFIT2', :'A_ITEM2', :'A', 'auto'),
  'outfit_items_source_check', 'outfit_items.source の範囲外の値は check で失敗する');
select test.expect_error(
  format('insert into public.media_deletion_queue (user_id, provider, provider_asset_id) values (%L, %L, %L)', :'A', 'cloudflare', 'bad-q'),
  'media_deletion_queue_provider_check', 'media_deletion_queue.provider の範囲外の値は check で失敗する');

-- 権限を直接確かめる（RLS は TRUNCATE などを守らないので、取り上げ忘れはここで見つける）
select test.assert(
  not exists (
    select 1
    from unnest(array['outfits', 'outfit_items', 'outfit_media', 'item_monthly_stats',
                      'item_pair_monthly_stats', 'outfit_combo_monthly_stats', 'media_deletion_queue']) t,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('anon', 'public.' || t, p)
       or has_table_privilege('public', 'public.' || t, p)),
  'anon・PUBLIC は新しいテーブルに何の権限もない');
select test.assert(
  not exists (
    select 1
    from unnest(array['outfits', 'outfit_items', 'outfit_media', 'item_monthly_stats',
                      'item_pair_monthly_stats', 'outfit_combo_monthly_stats']) t,
         unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', 'public.' || t, p))
  and (select bool_and(has_table_privilege('authenticated', 'public.' || t, 'SELECT'))
       from unnest(array['outfits', 'outfit_items', 'outfit_media', 'item_monthly_stats',
                         'item_pair_monthly_stats', 'outfit_combo_monthly_stats']) t),
  'authenticated は新しいテーブル6つで SELECT だけ');
select test.assert(
  not exists (
    select 1 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', 'public.media_deletion_queue', p)),
  'authenticated は media_deletion_queue に何の権限もない');
select test.assert(
  (select bool_and(has_table_privilege('service_role', 'public.' || t, p))
   from unnest(array['outfits', 'outfit_items', 'outfit_media', 'item_monthly_stats',
                     'item_pair_monthly_stats', 'outfit_combo_monthly_stats', 'media_deletion_queue']) t,
        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p)
  and not exists (
    select 1
    from unnest(array['outfits', 'outfit_items', 'outfit_media', 'item_monthly_stats',
                      'item_pair_monthly_stats', 'outfit_combo_monthly_stats', 'media_deletion_queue']) t,
         unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('service_role', 'public.' || t, p)),
  'service_role は SELECT/INSERT/UPDATE/DELETE だけ（TRUNCATE・REFERENCES・TRIGGER はなし）');

-- service_role で実際に insert / select / update / delete できる
set local role service_role;
select test.assert(current_user = 'service_role', 'service_role として操作する');
insert into public.outfits (id, user_id, worn_on, source)
values ('5e5e5e5e-0000-4000-8000-0000000000e5', :'A', '2026-10-09', 'manual');
select test.assert(
  (select count(*) from public.outfits where id = '5e5e5e5e-0000-4000-8000-0000000000e5') = 1,
  'service_role は outfits に insert して select できる');
update public.outfits set note = 'n' where id = '5e5e5e5e-0000-4000-8000-0000000000e5';
select test.assert(
  (select note from public.outfits where id = '5e5e5e5e-0000-4000-8000-0000000000e5') = 'n',
  'service_role は outfits を update できる');
delete from public.outfits where id = '5e5e5e5e-0000-4000-8000-0000000000e5';
select test.assert(
  not exists (select 1 from public.outfits where id = '5e5e5e5e-0000-4000-8000-0000000000e5'),
  'service_role は outfits を delete できる');
reset role;

rollback;
