-- =========================================
-- Re:closet 初期スキーマ
-- clothing_items / clothing_images / wear_logs
--
-- 実行順: テーブル作成 → インデックス → RLS有効化 → RLSポリシー
-- 注意: このファイルはまだSupabaseに実行していません。
-- =========================================

-- -----------------------------------------
-- 1. clothing_items
-- -----------------------------------------
create table public.clothing_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  brand           text,
  category        text not null,
  season          text,
  purchase_date   date,
  purchase_price  numeric(10, 2),
  last_worn_at    timestamptz,
  wear_count      integer not null default 0,
  favorite        boolean not null default false,
  status          text not null default 'active',
  created_at      timestamptz not null default now()
);

comment on column public.clothing_items.category is
  'text型で管理。選択肢はアプリ側で定義し、将来変更・追加してもDDL変更不要にする';
comment on column public.clothing_items.status is
  'text型で管理。選択肢はアプリ側で定義し、将来変更・追加してもDDL変更不要にする';
comment on column public.clothing_items.last_worn_at is
  'wear_logs追加時にアプリ側ロジックで更新する（DBトリガーは使わない）';
comment on column public.clothing_items.wear_count is
  'wear_logs追加時にアプリ側ロジックで更新する（DBトリガーは使わない）';

-- -----------------------------------------
-- 2. clothing_images
-- -----------------------------------------
create table public.clothing_images (
  id                 uuid primary key default gen_random_uuid(),
  clothing_item_id   uuid not null references public.clothing_items(id) on delete cascade,
  image_path         text not null,
  sort_order         integer not null default 0,
  unique (clothing_item_id, sort_order)
);

comment on column public.clothing_images.image_path is
  'Supabase Storage バケット内のパス。公開URLはアプリ側で生成する';
comment on column public.clothing_images.sort_order is
  '0から開始。(clothing_item_id, sort_order) でUNIQUE制約';

-- -----------------------------------------
-- 3. wear_logs
-- -----------------------------------------
create table public.wear_logs (
  id                 uuid primary key default gen_random_uuid(),
  clothing_item_id   uuid not null references public.clothing_items(id) on delete cascade,
  worn_at            timestamptz not null default now()
);

comment on table public.wear_logs is
  '1日に複数回の記録を許可する。現時点ではUNIQUE制約なし';

-- -----------------------------------------
-- 4. インデックス
-- -----------------------------------------

-- clothing_items: RLSで全クエリに user_id = auth.uid() がかかるため必須級
create index idx_clothing_items_user_id
  on public.clothing_items (user_id);

-- clothing_images: (clothing_item_id, sort_order) のUNIQUE制約が
-- clothing_item_id 単体の絞り込みにも使えるため、追加インデックスは不要

-- wear_logs: 「この服の着用履歴を新しい順に」を想定した複合インデックス
create index idx_wear_logs_clothing_item_id_worn_at
  on public.wear_logs (clothing_item_id, worn_at desc);

-- -----------------------------------------
-- 5. RLS有効化
-- -----------------------------------------
alter table public.clothing_items  enable row level security;
alter table public.clothing_images enable row level security;
alter table public.wear_logs       enable row level security;

-- -----------------------------------------
-- 6. RLSポリシー: clothing_items（user_idを直接持つ）
-- -----------------------------------------
create policy "clothing_items_select_own"
  on public.clothing_items for select
  using (user_id = (select auth.uid()));

create policy "clothing_items_insert_own"
  on public.clothing_items for insert
  with check (user_id = (select auth.uid()));

create policy "clothing_items_update_own"
  on public.clothing_items for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "clothing_items_delete_own"
  on public.clothing_items for delete
  using (user_id = (select auth.uid()));

-- -----------------------------------------
-- 7. RLSポリシー: clothing_images（clothing_items経由でuser_idを判定）
-- -----------------------------------------
create policy "clothing_images_select_own"
  on public.clothing_images for select
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

create policy "clothing_images_insert_own"
  on public.clothing_images for insert
  with check (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

create policy "clothing_images_update_own"
  on public.clothing_images for update
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

create policy "clothing_images_delete_own"
  on public.clothing_images for delete
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------
-- 8. RLSポリシー: wear_logs（clothing_items経由でuser_idを判定）
-- -----------------------------------------
create policy "wear_logs_select_own"
  on public.wear_logs for select
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = wear_logs.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

create policy "wear_logs_insert_own"
  on public.wear_logs for insert
  with check (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = wear_logs.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

create policy "wear_logs_update_own"
  on public.wear_logs for update
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = wear_logs.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = wear_logs.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

create policy "wear_logs_delete_own"
  on public.wear_logs for delete
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = wear_logs.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );
