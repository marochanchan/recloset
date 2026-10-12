-- =========================================
-- 016適用前: テスト用データの作成と、修正前の脆弱性の再現
-- （ローカルのDockerのPostgres専用。本番では実行しない）
-- =========================================
\set ON_ERROR_STOP on
\i supabase/tests/_fixtures.sql

create schema test;
grant usage on schema test to anon, authenticated;
create function test.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'ok: %', msg;
end;
$$;
-- stmt がRLS・権限で拒否されることを確認する（拒否されなければ失敗）
create function test.expect_denied(stmt text, msg text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    raise notice 'ok (denied): %', msg;
    return;
  end;
  raise exception 'FAIL (not denied): %', msg;
end;
$$;
grant execute on all functions in schema test to anon, authenticated;

-- ユーザー・服・画像（postgresで作成。RLSの対象外）
insert into auth.users (id) values (:'A'), (:'B');
insert into public.clothing_items (id, user_id, title, category, is_public, published_at) values
  (:'A_PRIV', :'A', 'A private', 'tops', false, null),
  (:'A_PUB',  :'A', 'A public',  'tops', true,  now()),
  (:'B_PRIV', :'B', 'B private', 'tops', false, null),
  (:'B_PUB',  :'B', 'B public',  'tops', true,  now());
insert into public.clothing_images (clothing_item_id, image_path, sort_order) values
  (:'A_PRIV', :'P_A_PRIV', 0),
  (:'A_PUB',  :'P_A_PUB',  0),
  (:'B_PRIV', :'P_B_PRIV', 0),
  (:'B_PUB',  :'P_B_PUB',  0);
insert into storage.objects (bucket_id, name) values
  ('clothing-images', :'P_A_PRIV'),
  ('clothing-images', :'P_A_PUB'),
  ('clothing-images', :'P_A_PUB2'),
  ('clothing-images', :'P_B_PRIV'),
  ('clothing-images', :'P_B_PUB');

-- 修正前: AがBの非公開画像のパスを自分の公開中の服に登録できてしまう
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
insert into public.clothing_images (clothing_item_id, image_path, sort_order)
  values (:'A_PUB', :'P_B_PRIV', 5);
reset role;
select test.assert(
  exists (select 1 from public.clothing_images where clothing_item_id = :'A_PUB' and image_path = :'P_B_PRIV'),
  '[修正前] 他人のパスを自分の服に登録できてしまう（脆弱性の再現）'
);

-- 修正前: その結果、未ログインでもBの非公開画像を参照（署名）できてしまう
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.assert(
  public.is_public_clothing_image(:'P_B_PRIV'),
  '[修正前] Bの非公開画像が公開扱いになってしまう（脆弱性の再現）'
);
select test.assert(
  (select count(*) from storage.objects where name = :'P_B_PRIV') = 1,
  '[修正前] anonがBの非公開画像のobjectを参照できてしまう（脆弱性の再現）'
);
reset role;
-- この不正な行は「既存の不整合データ」として016適用後のテストでも使う
