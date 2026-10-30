-- =========================================
-- Re:Closet: コーデ（着画）のスキーマ
--
-- 目的: 「1回の着用 = 1コーデ」と、そこに写る服の関係を保存する土台を作る。
-- テーブルの追加と、既存2テーブルへの列・制約の追加だけ（関数・トリガーは作らない）。
-- 書き込みの処理（RPC）は 022 以降で足す。
--
-- 方針:
-- - 所有者の一致は複合外部キーで守る。
--   (id, user_id) / (id, clothing_item_id) / (id, outfit_id) の一意制約を親に付け、
--   子はそれを参照する。他人の服・他人のメディア・他の服の着用記録は、DBが拒否する
-- - outfit_items の服への外部キーは on delete restrict（コーデに入っている服は消せない）。
--   wear_log_id は着用記録が消えたら null にする（行は残す）
-- - サマリー3表（*_monthly_stats）は事実から作り直せる派生データ。同期の対象ではないので
--   主キーは複合キー。服が消えたら一緒に消える
-- - media_deletion_queue は外部のメディア削除の待ち行列。user_id に外部キーを付けない
--   （ユーザーが消えても、外部に残ったメディアの削除は続ける）
--
-- 権限:
-- - RLS: media_deletion_queue 以外の全テーブルで本人（user_id = auth.uid()）の行だけ SELECT できる
--   media_deletion_queue は RLS 有効・ポリシーなし（直接は誰も読めない。サーバーは service_role で読み、RLS を通らない）
-- - authenticated には SELECT だけ（キューには何も与えない）。anon・PUBLIC には何も与えない。
--   service_role には SELECT・INSERT・UPDATE・DELETE
-- - Supabase は新しいテーブルに広い権限を自動で付けるため、最初に revoke all してから必要な分だけ grant する
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
--   全体を begin〜commit の1トランザクションで実行する。途中で失敗した場合は何も残らない
-- =========================================
begin;

-- -----------------------------------------
-- 1. 既存テーブルへの追加
-- -----------------------------------------
alter table public.clothing_items
  add column archived_at timestamptz,
  add constraint clothing_items_id_user_id_key unique (id, user_id),
  -- 公開中の服はアーカイブできない（008 の is_public / published_at の制約とは別に、両立する）
  add constraint clothing_items_archived_not_public check (archived_at is null or not is_public);

comment on column public.clothing_items.archived_at is
  'アーカイブした日時。null なら通常。アーカイブ済みの服は公開できない';

-- 既存の着用記録はすべて default の wear_today になる
alter table public.wear_logs
  add column source text not null default 'wear_today'
    constraint wear_logs_source_check check (source in ('wear_today', 'outfit')),
  -- outfit_items が「その服の着用記録」だけをつなげるための参照先
  add constraint wear_logs_id_clothing_item_id_key unique (id, clothing_item_id);

comment on column public.wear_logs.source is
  '記録の経路。wear_today = 今日着たボタン、outfit = コーデから作られた記録';

-- -----------------------------------------
-- 2. コーデ・メディア・コーデの中の服
-- -----------------------------------------
create table public.outfits (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  worn_on              date not null,
  source               text not null
    constraint outfits_source_check check (source in ('mirror', 'upload', 'manual', 'wear_suggestion')),
  status               text not null default 'pending'
    constraint outfits_status_check check (status in ('pending', 'confirmed')),
  revision             integer not null default 0,
  client_request_id    uuid,
  analysis_media_id    uuid,
  selected_person_index integer,
  note                 text,
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- 同じ端末からの再送を1回にまとめる
  constraint outfits_user_id_client_request_id_key unique (user_id, client_request_id),
  constraint outfits_id_user_id_key unique (id, user_id)
);

create table public.outfit_media (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  outfit_id         uuid not null,
  kind              text not null
    constraint outfit_media_kind_check check (kind in ('photo', 'video', 'frame')),
  provider          text not null
    constraint outfit_media_provider_check check (provider in ('cf_images', 'cf_stream')),
  provider_asset_id text not null,
  upload_attempt    integer not null default 1,
  upload_expires_at timestamptz,
  status            text not null default 'uploading'
    constraint outfit_media_status_check check (status in ('uploading', 'processing', 'ready', 'failed')),
  width             integer,
  height            integer,
  duration_sec      numeric,
  taken_at          timestamptz,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint outfit_media_outfit_owner_fkey
    foreign key (outfit_id, user_id) references public.outfits (id, user_id) on delete cascade,
  constraint outfit_media_provider_asset_key unique (provider, provider_asset_id),
  constraint outfit_media_id_outfit_id_key unique (id, outfit_id)
);

-- 解析に使うメディアは同じコーデのものだけ。メディアが消えたら analysis_media_id だけ null にする
-- （列を指定しないと outfits.id まで null にしようとして失敗する。PostgreSQL 15 以降）
alter table public.outfits
  add constraint outfits_analysis_media_fkey
    foreign key (analysis_media_id, id) references public.outfit_media (id, outfit_id)
    on delete set null (analysis_media_id);

create table public.outfit_items (
  outfit_id    uuid not null,
  item_id      uuid not null,
  user_id      uuid not null,
  wear_log_id  uuid unique,
  source       text not null default 'manual'
    constraint outfit_items_source_check check (source in ('detected', 'manual')),
  detection_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (outfit_id, item_id),
  constraint outfit_items_outfit_owner_fkey
    foreign key (outfit_id, user_id) references public.outfits (id, user_id) on delete cascade,
  -- コーデに入っている服は消せない
  constraint outfit_items_item_owner_fkey
    foreign key (item_id, user_id) references public.clothing_items (id, user_id) on delete restrict,
  -- その服の着用記録しかつなげない。wear_log_id が null の行は確かめない（match simple）
  constraint outfit_items_wear_log_fkey
    foreign key (wear_log_id, item_id) references public.wear_logs (id, clothing_item_id)
    on delete set null (wear_log_id)
);

-- -----------------------------------------
-- 3. 月ごとのサマリー（事実から作り直せる派生データ）
-- -----------------------------------------
create table public.item_monthly_stats (
  user_id        uuid not null,
  item_id        uuid not null,
  month          date not null,
  wear_log_count integer not null default 0,
  worn_days      integer not null default 0,
  outfit_count   integer not null default 0,
  last_worn_on   date,
  updated_at     timestamptz not null default now(),
  primary key (user_id, item_id, month),
  constraint item_monthly_stats_month_first_day check (extract(day from month) = 1),
  constraint item_monthly_stats_item_fkey
    foreign key (item_id, user_id) references public.clothing_items (id, user_id) on delete cascade
);

create table public.item_pair_monthly_stats (
  user_id       uuid not null,
  item_a        uuid not null,
  item_b        uuid not null,
  month         date not null,
  outfit_count  integer not null default 0,
  together_days integer not null default 0,
  last_worn_on  date,
  updated_at    timestamptz not null default now(),
  primary key (user_id, item_a, item_b, month),
  -- 組み合わせは小さい方を item_a にそろえる
  constraint item_pair_monthly_stats_order check (item_a < item_b),
  constraint item_pair_monthly_stats_month_first_day check (extract(day from month) = 1),
  constraint item_pair_monthly_stats_item_a_fkey
    foreign key (item_a, user_id) references public.clothing_items (id, user_id) on delete cascade,
  constraint item_pair_monthly_stats_item_b_fkey
    foreign key (item_b, user_id) references public.clothing_items (id, user_id) on delete cascade
);

create table public.outfit_combo_monthly_stats (
  user_id      uuid not null references auth.users(id) on delete cascade,
  combo_key    text not null,
  item_ids     uuid[] not null,
  month        date not null,
  outfit_count integer not null default 0,
  last_worn_on date,
  updated_at   timestamptz not null default now(),
  primary key (user_id, combo_key, month),
  constraint outfit_combo_monthly_stats_month_first_day check (extract(day from month) = 1)
);

-- -----------------------------------------
-- 4. メディア削除の待ち行列（サーバーだけが触る）
-- -----------------------------------------
create table public.media_deletion_queue (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,  -- 外部キーなし（ユーザーが消えても削除は続ける）
  provider          text not null
    constraint media_deletion_queue_provider_check check (provider in ('cf_images', 'cf_stream')),
  provider_asset_id text not null,
  attempts          integer not null default 0,
  next_attempt_at   timestamptz not null default now(),
  claim_token       uuid,
  lease_until       timestamptz,
  last_error        text,
  done_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint media_deletion_queue_asset_key unique (provider, provider_asset_id)
);

-- -----------------------------------------
-- 5. インデックス
-- -----------------------------------------
create index idx_outfits_user_worn_on on public.outfits (user_id, worn_on desc);
create index idx_outfit_items_user_item on public.outfit_items (user_id, item_id);
create index idx_outfit_media_outfit_sort on public.outfit_media (outfit_id, sort_order);
create index idx_media_deletion_queue_pending
  on public.media_deletion_queue (next_attempt_at) where done_at is null;

-- -----------------------------------------
-- 6. RLS・GRANT
-- -----------------------------------------
alter table public.outfits                    enable row level security;
alter table public.outfit_media               enable row level security;
alter table public.outfit_items               enable row level security;
alter table public.item_monthly_stats         enable row level security;
alter table public.item_pair_monthly_stats    enable row level security;
alter table public.outfit_combo_monthly_stats enable row level security;
alter table public.media_deletion_queue       enable row level security;

-- SELECT のポリシーだけ（INSERT/UPDATE/DELETE は作らない）
create policy "outfits_select_own" on public.outfits
  for select using (user_id = (select auth.uid()));
create policy "outfit_media_select_own" on public.outfit_media
  for select using (user_id = (select auth.uid()));
create policy "outfit_items_select_own" on public.outfit_items
  for select using (user_id = (select auth.uid()));
create policy "item_monthly_stats_select_own" on public.item_monthly_stats
  for select using (user_id = (select auth.uid()));
create policy "item_pair_monthly_stats_select_own" on public.item_pair_monthly_stats
  for select using (user_id = (select auth.uid()));
create policy "outfit_combo_monthly_stats_select_own" on public.outfit_combo_monthly_stats
  for select using (user_id = (select auth.uid()));

revoke all on table
  public.outfits, public.outfit_media, public.outfit_items,
  public.item_monthly_stats, public.item_pair_monthly_stats, public.outfit_combo_monthly_stats,
  public.media_deletion_queue
  from public, anon, authenticated, service_role;

grant select on table
  public.outfits, public.outfit_media, public.outfit_items,
  public.item_monthly_stats, public.item_pair_monthly_stats, public.outfit_combo_monthly_stats
  to authenticated;

-- キューは authenticated に何も与えない
grant select, insert, update, delete on table
  public.outfits, public.outfit_media, public.outfit_items,
  public.item_monthly_stats, public.item_pair_monthly_stats, public.outfit_combo_monthly_stats,
  public.media_deletion_queue
  to service_role;

commit;
