-- =========================================
-- migration 023（メディアと削除待ちの RPC）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 操作は set local role service_role で行う（サーバーと同じ）。確かめるときは postgres に戻る。
-- 全体を begin〜rollback で包む（ユーザー C のデータには触らない）。
-- now() はトランザクションの中で動かないので、時間が過ぎたことは postgres で時刻の列を過去にして表す
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set OX 'e0000001-0000-4000-8000-000000000001'
\set OY 'e0000002-0000-4000-8000-000000000002'
\set OB 'e0000003-0000-4000-8000-000000000003'
\set M1 'e1000001-0000-4000-8000-000000000001'
\set M2 'e1000002-0000-4000-8000-000000000002'
\set M3 'e1000003-0000-4000-8000-000000000003'
\set M4 'e1000004-0000-4000-8000-000000000004'
\set M5 'e1000005-0000-4000-8000-000000000005'
\set MB 'e1000006-0000-4000-8000-000000000006'

begin;

create function test.as_service() returns void language plpgsql as $$
begin
  reset role;
  set local role service_role;
  if current_user <> 'service_role' then
    raise exception 'FAIL: as_service mismatch (%)', current_user;
  end if;
end;
$$;

create function test.as_postgres() returns void language plpgsql as $$
begin
  reset role;
  if current_user <> 'postgres' then
    raise exception 'FAIL: as_postgres mismatch (%)', current_user;
  end if;
end;
$$;

create function test.as_role(p_role text) returns void language plpgsql as $$
begin
  reset role;
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', '', true);
  if current_user <> p_role then
    raise exception 'FAIL: as_role mismatch (%)', current_user;
  end if;
end;
$$;

grant execute on all functions in schema test to anon, authenticated, service_role;

-- 準備（postgres）
delete from public.media_deletion_queue;
insert into public.outfits (id, user_id, worn_on, source)
values (:'OX', :'A', '2025-10-31', 'upload'),
       (:'OY', :'A', '2025-11-01', 'upload'),
       (:'OB', :'B', '2025-10-31', 'upload');

-- -----------------------------------------
-- register_outfit_media
-- -----------------------------------------
select test.as_service();
select test.assert(current_user = 'service_role', 'service_role として実行している');

select test.expect_error(
  format($$select public.register_outfit_media(%L, %L, %L, 'photo', 'cf_images', 'img-b', null, null, 0)$$, :'A', :'M1', :'OB'),
  'outfit_not_found', 'B のコーデに A の user_id で登録すると outfit_not_found');

select public.register_outfit_media(:'A', :'M1', :'OX', 'photo', 'cf_images', 'img-1', now() + interval '30 minutes', null, 0);
select test.as_postgres();
select test.assert(
  (select count(*) from public.outfit_media where id = :'M1') = 1
  and (select provider_asset_id from public.outfit_media where id = :'M1') = 'img-1'
  and (select status from public.outfit_media where id = :'M1') = 'uploading'
  and (select upload_attempt from public.outfit_media where id = :'M1') = 1,
  'register_outfit_media が service_role から成功し、uploading・試行1で入る');
select test.assert(
  (select analysis_media_id from public.outfits where id = :'OX') = :'M1'::uuid,
  '最初の写真が analysis_media_id になる');

-- 2回目: 別の asset ID を渡しても、行は1件で provider_asset_id は1回目のまま
select test.as_service();
select test.assert(
  (select provider_asset_id from public.register_outfit_media(:'A', :'M1', :'OX', 'photo', 'cf_images', 'img-other', null, null, 0)) = 'img-1',
  '同じ media_id・同じコーデで2回呼ぶと、返る provider_asset_id は1回目のまま');
select test.as_postgres();
select test.assert(
  (select count(*) from public.outfit_media where id = :'M1') = 1
  and not exists (select 1 from public.outfit_media where provider_asset_id = 'img-other'),
  '2回目でも行は1件で、別の asset ID は入らない');

-- 2枚目の写真では analysis_media_id が変わらない
select test.as_service();
select public.register_outfit_media(:'A', :'M2', :'OX', 'photo', 'cf_images', 'img-2', null, null, 1);
select test.as_postgres();
select test.assert(
  (select analysis_media_id from public.outfits where id = :'OX') = :'M1'::uuid,
  '2枚目の写真では analysis_media_id が変わらない');

-- 他人の media_id・別コーデ・kind 違いは media_conflict
select test.as_service();
select public.register_outfit_media(:'B', :'MB', :'OB', 'photo', 'cf_images', 'img-bb', null, null, 0);
select test.expect_error(
  format($$select public.register_outfit_media(%L, %L, %L, 'photo', 'cf_images', 'x', null, null, 0)$$, :'A', :'MB', :'OX'),
  'media_conflict', 'B の media_id を A の user_id で呼ぶと media_conflict');
select test.expect_error(
  format($$select public.register_outfit_media(%L, %L, %L, 'photo', 'cf_images', 'x', null, null, 0)$$, :'A', :'M1', :'OY'),
  'media_conflict', '同じ A の別コーデ Y で M1 を登録すると media_conflict');
select test.expect_error(
  format($$select public.register_outfit_media(%L, %L, %L, 'video', 'cf_stream', 'x', null, null, 0)$$, :'A', :'M1', :'OY'),
  'media_conflict', 'kind・provider が違っても別コーデなら media_conflict');
select test.expect_error(
  format($$select public.register_outfit_media(%L, %L, %L, 'video', 'cf_stream', 'x', null, null, 0)$$, :'A', :'M1', :'OX'),
  'media_conflict', '同じコーデでも kind・provider が違えば media_conflict');
select test.expect_error(
  format($$select public.register_outfit_media(%L, %L, %L, 'photo', 'cf_images', 'img-1', null, null, 0)$$, :'A', :'M3', :'OX'),
  'outfit_media_provider_asset_key', '同じ provider_asset_id を別のメディアに登録すると一意制約で失敗する');

-- -----------------------------------------
-- replace_outfit_media_asset
-- -----------------------------------------
select test.expect_error(
  format($$select public.replace_outfit_media_asset(%L, %L, 1, 'n', null)$$, :'B', :'M1'),
  'media_not_found', '他人の行の replace は media_not_found');
select public.replace_outfit_media_asset(:'A', :'M1', 1, 'img-1b', now() + interval '30 minutes');
select test.as_postgres();
select test.assert(
  (select provider_asset_id from public.outfit_media where id = :'M1') = 'img-1b'
  and (select upload_attempt from public.outfit_media where id = :'M1') = 2
  and (select status from public.outfit_media where id = :'M1') = 'uploading'
  and (select count(*) from public.media_deletion_queue
        where provider = 'cf_images' and provider_asset_id = 'img-1' and user_id = :'A') = 1,
  'replace（expected 1）で古い ID が削除待ちに入り、upload_attempt が 2、新しい ID になる');

select test.as_service();
select test.expect_error(
  format($$select public.replace_outfit_media_asset(%L, %L, 1, 'img-1c', null)$$, :'A', :'M1'),
  'media_attempt_changed', 'expected 1 のままもう一度 replace すると media_attempt_changed');
select test.as_postgres();
select test.assert(
  (select provider_asset_id from public.outfit_media where id = :'M1') = 'img-1b'
  and not exists (select 1 from public.outfit_media where provider_asset_id = 'img-1c')
  and (select count(*) from public.media_deletion_queue) = 1,
  'media_attempt_changed では新しい ID は入らず、削除待ちも増えない');

-- processing / ready は変えない
update public.outfit_media set status = 'ready' where id = :'M1';
select test.as_service();
select public.replace_outfit_media_asset(:'A', :'M1', 2, 'img-1d', null);
select test.as_postgres();
select test.assert(
  (select provider_asset_id from public.outfit_media where id = :'M1') = 'img-1b'
  and (select upload_attempt from public.outfit_media where id = :'M1') = 2
  and (select status from public.outfit_media where id = :'M1') = 'ready'
  and (select count(*) from public.media_deletion_queue) = 1,
  'ready のメディアの replace は行を変えず、削除待ちも増えない');
update public.outfit_media set status = 'processing' where id = :'M1';
select test.as_service();
select public.replace_outfit_media_asset(:'A', :'M1', 2, 'img-1d', null);
select test.as_postgres();
select test.assert(
  (select provider_asset_id from public.outfit_media where id = :'M1') = 'img-1b'
  and (select upload_attempt from public.outfit_media where id = :'M1') = 2
  and (select status from public.outfit_media where id = :'M1') = 'processing'
  and (select count(*) from public.media_deletion_queue) = 1,
  'processing のメディアの replace は行を変えず、削除待ちも増えない');

-- failed なら置き換わる
update public.outfit_media set status = 'failed' where id = :'M1';
select test.as_service();
select public.replace_outfit_media_asset(:'A', :'M1', 2, 'img-1e', null);
select test.as_postgres();
select test.assert(
  (select provider_asset_id from public.outfit_media where id = :'M1') = 'img-1e'
  and (select upload_attempt from public.outfit_media where id = :'M1') = 3
  and (select status from public.outfit_media where id = :'M1') = 'uploading'
  and exists (select 1 from public.media_deletion_queue where provider_asset_id = 'img-1b'),
  'failed のメディアの replace は置き換わり、古い ID が削除待ちに入る');

-- -----------------------------------------
-- set_outfit_media_state
-- -----------------------------------------
select test.as_service();
select test.expect_error(
  format($$select public.set_outfit_media_state(%L, %L, 1, 'ready', 10, 10, null)$$, :'A', :'M1'),
  'media_attempt_changed', '古い expected の set_outfit_media_state は media_attempt_changed');
select test.expect_error(
  format($$select public.set_outfit_media_state(%L, %L, 3, 'ready', 10, 10, null)$$, :'B', :'M1'),
  'media_not_found', '他人の行の set_outfit_media_state は media_not_found');
select test.as_postgres();
select test.assert(
  (select status from public.outfit_media where id = :'M1') = 'uploading',
  'media_attempt_changed のとき状態は変わらない');

select test.as_service();
select public.set_outfit_media_state(:'A', :'M1', 3, 'processing', null, null, null);
select public.set_outfit_media_state(:'A', :'M1', 3, 'processing', null, null, null);
select test.assert(
  (select status from public.outfit_media where id = :'M1') = 'processing',
  'uploading → processing → processing は通る');
select public.set_outfit_media_state(:'A', :'M1', 3, 'ready', 800, 600, 1.5);
select test.assert(
  (select status from public.outfit_media where id = :'M1') = 'ready'
  and (select width from public.outfit_media where id = :'M1') = 800
  and (select height from public.outfit_media where id = :'M1') = 600
  and (select duration_sec from public.outfit_media where id = :'M1') = 1.5,
  'processing → ready で寸法・長さが入る');
select public.set_outfit_media_state(:'A', :'M1', 3, 'ready', 800, 600, 1.5);
select test.assert(true, 'ready → ready は通る');
select test.expect_error(
  format($$select public.set_outfit_media_state(%L, %L, 3, 'uploading', null, null, null)$$, :'A', :'M1'),
  'invalid_media_transition', 'ready → uploading は invalid_media_transition');
select test.expect_error(
  format($$select public.set_outfit_media_state(%L, %L, 3, 'processing', null, null, null)$$, :'A', :'M1'),
  'invalid_media_transition', 'ready → processing は invalid_media_transition');
select public.register_outfit_media(:'A', :'M3', :'OX', 'photo', 'cf_images', 'img-3', null, null, 2);
select public.set_outfit_media_state(:'A', :'M3', 1, 'failed', null, null, null);
select test.expect_error(
  format($$select public.set_outfit_media_state(%L, %L, 1, 'ready', null, null, null)$$, :'A', :'M3'),
  'invalid_media_transition', 'failed → ready は invalid_media_transition');

-- -----------------------------------------
-- apply_stream_webhook
-- -----------------------------------------
select public.register_outfit_media(:'A', :'M4', :'OY', 'video', 'cf_stream', 'vid-4', null, null, 0);
select test.assert(public.apply_stream_webhook('vid-old', 'ready', 1, 1, 1) = 'ignored', '古い（知らない）ID は ignored');
select test.assert(public.apply_stream_webhook('img-1e', 'ready', 1, 1, 1) = 'ignored', 'cf_images の ID は ignored');
select test.assert(public.apply_stream_webhook('vid-4', 'ready', 1280, 720, 12.5) = 'applied', '今の ID の ready は applied');
select test.assert(public.apply_stream_webhook('vid-4', 'ready', 1280, 720, 12.5) = 'duplicate', 'もう一度 ready は duplicate');
select test.assert(public.apply_stream_webhook('vid-4', 'processing', null, null, null) = 'ignored', 'ready のあとの processing は ignored');
select test.expect_error($$select public.apply_stream_webhook('vid-4', 'bogus', null, null, null)$$,
  'invalid_media_status', '不正な p_status は例外');
select test.as_postgres();
select test.assert(
  (select status from public.outfit_media where id = :'M4') = 'ready'
  and (select width from public.outfit_media where id = :'M4') = 1280
  and (select duration_sec from public.outfit_media where id = :'M4') = 12.5,
  'ready のあとの processing で状態は ready のまま、寸法も残る');
select test.as_service();
select public.register_outfit_media(:'A', :'M5', :'OY', 'video', 'cf_stream', 'vid-5', null, null, 1);
select test.assert(public.apply_stream_webhook('vid-5', 'failed', null, null, null) = 'applied', 'uploading → failed は applied');
select test.assert(public.apply_stream_webhook('vid-5', 'ready', 1, 1, 1) = 'ignored', 'failed のあとの ready は ignored');
select test.as_postgres();
select test.assert((select status from public.outfit_media where id = :'M5') = 'failed', 'failed のまま');

-- -----------------------------------------
-- claim_media_deletions / finish_media_deletion
-- -----------------------------------------
delete from public.media_deletion_queue;
select public.enqueue_media_deletion(:'A', 'cf_images', 'q-1');
select public.enqueue_media_deletion(:'A', 'cf_images', 'q-2');
create temp table _claim (id uuid, tok uuid, asset text);
grant all on _claim to service_role;

select test.as_service();
insert into _claim select id, claim_token, provider_asset_id from public.claim_media_deletions(1);
select test.assert((select count(*) from _claim) = 1, 'claim_media_deletions(1) は1件返す');
select test.assert((select count(*) from public.claim_media_deletions(10)) = 1,
  '2回目の claim は、リース中の行を除いた1件だけ返す');
select test.assert((select count(*) from public.claim_media_deletions(10)) = 0, 'リース中は取り出されない');
select test.as_postgres();
select test.assert(
  (select lease_until from public.media_deletion_queue where id = (select id from _claim)) > now() + interval '4 minutes'
  and (select claim_token from public.media_deletion_queue where id = (select id from _claim)) = (select tok from _claim),
  'claim_token と約5分のリースが書かれる');
update public.media_deletion_queue set lease_until = now() - interval '1 second' where id = (select id from _claim);
select test.as_service();
select test.assert(
  (select count(*) from public.claim_media_deletions(10) c where c.id = (select id from _claim) and c.claim_token <> (select tok from _claim)) = 1,
  'lease_until が過去なら、別の claim_token で取り出し直せる');
select test.as_postgres();
select test.assert((select claim_token from public.media_deletion_queue where id = (select id from _claim)) <> (select tok from _claim),
  '古い claim_token は上書きされている');

select test.as_service();
select test.assert(public.finish_media_deletion((select id from _claim), (select tok from _claim), true, null) = false,
  '古い claim_token の finish は false');
select test.as_postgres();
select test.assert(
  (select done_at is null and attempts = 0 and claim_token is not null from public.media_deletion_queue where id = (select id from _claim)),
  '古い claim_token の finish では行が変わらない');

-- 成功
select test.as_service();
select test.assert(public.finish_media_deletion(
  (select id from public.media_deletion_queue where claim_token is not null and id = (select id from _claim)),
  (select claim_token from public.media_deletion_queue where id = (select id from _claim)), true, null) = true,
  '正しい claim_token の finish は true');
select test.as_postgres();
select test.assert(
  (select done_at is not null and claim_token is null and lease_until is null from public.media_deletion_queue where id = (select id from _claim)),
  '成功で done_at が入り、claim_token・lease_until が null に戻る');

-- 失敗のバックオフ: 1回目1分、2回目10分、3回目1時間、4回目1日
create temp table _bo (n int, secs numeric);
grant all on _bo to service_role;
do $$
declare
  v_id uuid := (select id from public.media_deletion_queue where provider_asset_id = 'q-1' and done_at is null
                union all select id from public.media_deletion_queue where provider_asset_id = 'q-2' and done_at is null limit 1);
  v_tok uuid;
  v_next timestamptz;
begin
  for i in 1..4 loop
    update public.media_deletion_queue set next_attempt_at = now() - interval '1 second', lease_until = null where id = v_id;
    set local role service_role;
    select claim_token into v_tok from public.claim_media_deletions(10) where id = v_id;
    if v_tok is null then raise exception 'FAIL: backoff claim % returned nothing', i; end if;
    perform public.finish_media_deletion(v_id, v_tok, false, 'boom');
    reset role;
    select next_attempt_at into v_next from public.media_deletion_queue where id = v_id;
    insert into _bo values (i, extract(epoch from v_next - now()));
  end loop;
end $$;
select test.assert(
  (select secs from _bo where n = 1) = 60 and (select secs from _bo where n = 2) = 600
  and (select secs from _bo where n = 3) = 3600 and (select secs from _bo where n = 4) = 86400,
  '失敗の延ばす幅は 1分・10分・1時間・1日（4回目で約1日後）');
select test.assert(
  (select attempts = 4 and last_error = 'boom' and done_at is null and claim_token is null and lease_until is null
     from public.media_deletion_queue where id = (select id from public.media_deletion_queue where attempts = 4)),
  '失敗で attempts と last_error が記録され、claim_token・lease_until が null');

-- 10回失敗した行は claim されない
update public.media_deletion_queue set attempts = 10, next_attempt_at = now() - interval '1 day', lease_until = null
 where attempts = 4;
select test.as_service();
select test.assert((select count(*) from public.claim_media_deletions(10)) = 0, '10回失敗した行は claim されない');

-- -----------------------------------------
-- 権限
-- -----------------------------------------
select test.as_role('authenticated');
select test.expect_denied(format($$select public.register_outfit_media(%L, %L, %L, 'photo', 'cf_images', 'z', null, null, 0)$$, :'A', gen_random_uuid(), :'OX'),
  'authenticated は register_outfit_media を呼べない');
select test.expect_denied('select * from public.claim_media_deletions(1)', 'authenticated は claim_media_deletions を呼べない');
select test.expect_denied(format($$select public.rebuild_monthly_stats(%L, '2025-10-01')$$, :'A'), 'authenticated は rebuild_monthly_stats を呼べない');
select test.as_role('anon');
select test.expect_denied(format($$select public.register_outfit_media(%L, %L, %L, 'photo', 'cf_images', 'z', null, null, 0)$$, :'A', gen_random_uuid(), :'OX'),
  'anon は register_outfit_media を呼べない');
select test.expect_denied('select * from public.claim_media_deletions(1)', 'anon は claim_media_deletions を呼べない');
select test.expect_denied(format($$select public.rebuild_monthly_stats(%L, '2025-10-01')$$, :'A'), 'anon は rebuild_monthly_stats を呼べない');
select test.as_service();
select test.expect_denied(format($$select public.enqueue_media_deletion(%L, 'cf_images', 'zz')$$, :'A'),
  'service_role も内部用の enqueue_media_deletion は呼べない');

select test.as_postgres();
rollback;
