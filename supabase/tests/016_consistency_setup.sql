-- 確認用SQL（クエリ1）と016の関数の判定一致を確かめるためのデータ（ローカルテスト専用）
-- 判定表と同じ種類のパスを、RLSを通さず（postgres権限で）直接投入する
\set ON_ERROR_STOP on
\i supabase/tests/_fixtures.sql
insert into public.clothing_images (clothing_item_id, image_path, sort_order)
select :'A_PRIV', p, 100 + row_number() over ()
from unnest(array[
  :'A' || '/x.jpg',
  :'A' || '/a/b/c.png',
  :'A' || '/item/.hidden.jpg',
  :'A' || '/item/a..b.jpg',
  '',
  :'A',
  :'A' || '/',
  :'A' || '/item/',
  '/' || :'A' || '/x.jpg',
  :'A' || '//x.jpg',
  :'A' || '/./x.jpg',
  :'A' || '/item/.',
  :'A' || '/../' || :'P_B_PRIV',
  :'A' || '/item/..',
  :'P_B_PUB',
  :'A' || 'x/item/y.jpg',
  left(:'A', 35) || '/item/y.jpg',
  upper(:'A') || '/item/y.jpg'
]) as p;
