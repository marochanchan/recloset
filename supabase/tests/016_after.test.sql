-- =========================================
-- 016適用後: 修正の確認と、既存機能への影響の確認
-- （016_before.test.sql の後に実行する。ローカルのDockerのPostgres専用）
-- =========================================
\set ON_ERROR_STOP on
\i supabase/tests/_fixtures.sql

-- -----------------------------------------
-- 1. 公開判定・Storageの参照（anon）
-- -----------------------------------------
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.assert(not public.is_public_clothing_image(:'P_B_PRIV'),
  '既存の不整合な行があっても、Bの非公開画像は公開扱いにならない');
select test.assert((select count(*) from storage.objects where name = :'P_B_PRIV') = 0,
  'anonはBの非公開画像のobjectを参照できない');
select test.assert(public.is_public_clothing_image(:'P_A_PUB'),
  'Aの公開中の服の画像は従来どおり公開扱い');
select test.assert((select count(*) from storage.objects where name = :'P_A_PUB') = 1,
  'anonはAの公開画像を参照できる');
select test.assert((select count(*) from storage.objects where name = :'P_B_PUB') = 1,
  'anonはBの公開画像を参照できる');
select test.assert((select count(*) from storage.objects where name = :'P_A_PRIV') = 0,
  'anonはAの非公開画像を参照できない');
select test.assert(
  (select count(*) from public.list_public_clothing_items(50)) = 2,
  '公開RPC（list_public_clothing_items）は従来どおり公開中の2着を返す');
select test.assert(
  (select cardinality(image_paths) from public.get_public_clothing_item(:'B_PUB')) = 1,
  '公開RPC（get_public_clothing_item）は従来どおり画像パスを返す');
reset role;

-- -----------------------------------------
-- 2. Storageの参照（ログイン中の別ユーザー）
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
select test.assert((select count(*) from storage.objects where name = :'P_A_PRIV') = 0,
  'BはAの非公開画像を参照できない');
select test.assert((select count(*) from storage.objects where name = :'P_B_PRIV') = 1,
  'Bは自分の非公開画像を参照できる');
select test.assert((select count(*) from public.clothing_images where image_path = :'P_A_PRIV') = 0,
  'BはAの画像行を参照できない（SELECTポリシーは従来どおり）');

-- -----------------------------------------
-- 3. INSERT（A）
-- -----------------------------------------
select set_config('request.jwt.claim.sub', :'A', false);
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'P_B_PUB'),
  '他人（B）の公開画像のパスを自分の服に登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PRIV', :'P_B_PRIV'),
  '他人（B）の非公開画像のパスを自分の非公開の服にも登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'A' || '/../' || :'P_B_PRIV'),
  '".." を含むパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'A' || '//x.jpg'),
  '空のセグメントを含むパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'A' || '/'),
  '末尾が "/" のパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'A'),
  'フォルダのないパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'A' || 'x/' || :'A_PUB' || '/y.jpg'),
  'ユーザーIDの前方一致だけのパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', upper(:'A') || '/' || :'A_PUB' || '/y.jpg'),
  '大文字表記のユーザーIDのパスは登録できない（Storageの本人用ポリシーと同じ表現のみ）');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'B_PUB', :'P_A_PUB2'),
  '他人の服には（自分のパスでも）登録できない（従来どおり）');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', ''),
  '空のパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', '/' || :'P_A_PUB2'),
  '先頭が "/" のパスは登録できない');
select test.expect_denied(
  format('insert into public.clothing_images (clothing_item_id, image_path, sort_order) values (%L, %L, 10)', :'A_PUB', :'A' || '/./x.jpg'),
  '"." のセグメントを含むパスは登録できない');
insert into public.clothing_images (clothing_item_id, image_path, sort_order)
  values (:'A_PUB', :'P_A_PUB2', 1);
select test.assert(true, '本人の服に本人のフォルダの画像は登録できる（アプリの通常の登録）');

-- -----------------------------------------
-- 4. UPDATE（A）
-- -----------------------------------------
-- 編集画面と同じ並び替え（一時的に大きな値へ退避 → 確定値に戻す）
update public.clothing_images set sort_order = 1000 + sort_order
  where clothing_item_id = :'A_PUB' and image_path in (:'P_A_PUB', :'P_A_PUB2');
update public.clothing_images set sort_order = 1 where clothing_item_id = :'A_PUB' and image_path = :'P_A_PUB';
update public.clothing_images set sort_order = 0 where clothing_item_id = :'A_PUB' and image_path = :'P_A_PUB2';
select test.assert(
  (select sort_order from public.clothing_images where image_path = :'P_A_PUB2' and clothing_item_id = :'A_PUB') = 0,
  '本人の画像の並び替え（sort_orderのUPDATE）は従来どおりできる');
select test.expect_denied(
  format('update public.clothing_images set image_path = %L where clothing_item_id = %L and image_path = %L', :'P_B_PRIV', :'A_PUB', :'P_A_PUB'),
  'UPDATEで画像パスを他人のパスに付け替えられない');
select test.expect_denied(
  format('update public.clothing_images set clothing_item_id = %L where image_path = %L', :'B_PUB', :'P_A_PRIV'),
  'UPDATEで画像行を他人の服に付け替えられない');
update public.clothing_images set image_path = :'P_A_PRIV'
  where clothing_item_id = :'A_PUB' and image_path = :'P_A_PUB2';
update public.clothing_images set image_path = :'P_A_PUB2'
  where clothing_item_id = :'A_PUB' and image_path = :'P_A_PRIV';
select test.assert(true, 'UPDATEで本人のフォルダ内の別パスへの変更はできる');
-- 既存の不整合な行: 並び替え等のUPDATEは拒否され、削除はできる
select test.expect_denied(
  format('update public.clothing_images set sort_order = 6 where clothing_item_id = %L and image_path = %L', :'A_PUB', :'P_B_PRIV'),
  '既存の不整合な行はUPDATEできない（適用前の確認SQLで事前に把握する）');

-- -----------------------------------------
-- 5. 公開・非公開の切り替え（A）
-- -----------------------------------------
update public.clothing_items set is_public = false, published_at = null where id = :'A_PUB';
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.assert((select count(*) from storage.objects where name = :'P_A_PUB') = 0,
  '非公開に戻すと、anonはその画像を参照できない');
select test.assert((select count(*) from public.list_public_clothing_items(50)) = 1,
  '非公開に戻すと、公開RPCの一覧から消える');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
update public.clothing_items set is_public = true, published_at = now() where id = :'A_PUB';
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.assert((select count(*) from storage.objects where name = :'P_A_PUB') = 1,
  '再公開すると、anonはその画像を再び参照できる');
select test.assert(not public.is_public_clothing_image(:'P_B_PRIV'),
  '再公開しても、不整合な行のBの画像は公開扱いにならない');
reset role;

-- -----------------------------------------
-- 6. 削除（A）
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
delete from public.clothing_images where clothing_item_id = :'A_PUB' and image_path = :'P_A_PUB2';
select test.assert(
  not exists (select 1 from public.clothing_images where image_path = :'P_A_PUB2'),
  '本人の画像行は従来どおり削除できる');
reset role;

-- -----------------------------------------
-- 6-b. 所有者判定関数の判定表（期待値どおりか）
-- -----------------------------------------
create temp table path_cases (path text, expected boolean, note text);
insert into path_cases values
  (:'P_A_PUB',                                   true,  'アプリの通常のパス {user}/{item}/{file}'),
  (:'A' || '/x.jpg',                             true,  'ユーザーIDのフォルダ直下のファイル'),
  (:'A' || '/a/b/c.png',                         true,  '深い階層'),
  (:'A' || '/item/.hidden.jpg',                  true,  '"." で始まるファイル名（"." そのものではない）'),
  (:'A' || '/item/a..b.jpg',                     true,  '".." を含むファイル名（".." そのものではない）'),
  ('',                                           false, '空パス'),
  (:'A',                                         false, 'フォルダのみ（ファイル名なし）'),
  (:'A' || '/',                                  false, '末尾が "/"（ファイル名が空）'),
  (:'A' || '/item/',                             false, '末尾が "/"（2階層）'),
  ('/' || :'A' || '/x.jpg',                      false, '先頭が "/"'),
  (:'A' || '//x.jpg',                            false, '"//"'),
  (:'A' || '/item//x.jpg',                       false, '途中の "//"'),
  (:'A' || '/./x.jpg',                           false, '"." のセグメント'),
  (:'A' || '/item/.',                            false, '"." のファイル名'),
  (:'A' || '/../' || :'P_B_PRIV',                false, '".." のセグメント'),
  (:'A' || '/item/..',                           false, '".." のファイル名'),
  (:'P_B_PRIV',                                  false, '他人のユーザーID'),
  (:'A' || 'x/item/y.jpg',                       false, 'UUID前方一致の偽装（後ろに文字を追加）'),
  (left(:'A', 35) || '/item/y.jpg',              false, 'UUID前方一致の偽装（末尾を削除）'),
  (upper(:'A') || '/item/y.jpg',                 false, '大文字表記のユーザーID'),
  (' ' || :'A' || '/item/y.jpg',                 false, '先頭に空白'),
  (null,                                         false, 'NULL');
select test.assert(
  public.is_clothing_image_path_owned_by(path, :'A') = expected,
  format('判定表: %s → %s', note, expected)
) from path_cases order by expected desc, note;
select test.assert(
  (select count(*) from path_cases where public.is_clothing_image_path_owned_by(path, :'A') is null) = 0,
  '判定表: どのケースでもNULLを返さない');

-- -----------------------------------------
-- 7. 関数・GRANT
-- -----------------------------------------
select test.assert(
  not has_function_privilege('anon', 'public.is_clothing_image_path_owned_by(text, uuid)', 'execute'),
  'anonは所有者判定関数を実行できない');
select test.assert(
  has_function_privilege('authenticated', 'public.is_clothing_image_path_owned_by(text, uuid)', 'execute'),
  'authenticatedは所有者判定関数を実行できる（RLSの評価に必要）');
select test.assert(
  has_function_privilege('anon', 'public.is_public_clothing_image(text)', 'execute')
    and has_function_privilege('authenticated', 'public.is_public_clothing_image(text)', 'execute'),
  '公開判定関数はanon/authenticatedが実行できる（008と同じ）');
select test.assert(
  (select prosecdef from pg_proc where oid = 'public.is_public_clothing_image(text)'::regprocedure)
    and (select proconfig from pg_proc where oid = 'public.is_public_clothing_image(text)'::regprocedure) = array['search_path=""'],
  '公開判定関数は security definer かつ search_path 固定のまま');
select test.assert(
  not (select prosecdef from pg_proc where oid = 'public.is_clothing_image_path_owned_by(text, uuid)'::regprocedure),
  '所有者判定関数は security definer ではない');
select test.assert(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'clothing_images') = 4,
  'clothing_images のポリシーは4つ（重複なし）');
select test.assert(
  not public.is_clothing_image_path_owned_by(null, :'A')
    and not public.is_clothing_image_path_owned_by(:'P_A_PUB', null),
  'NULLはfalse（NULLを返さない）');

\echo 'ALL 016 TESTS PASSED'
