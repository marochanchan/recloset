-- =========================================
-- ローカルテスト専用: Supabaseの auth / storage / ロールの最小限の代役
--
-- 素のPostgres（Docker）でmigrationとRLSを検証するためのもの。
-- 本番・Supabaseのプロジェクトでは絶対に実行しない。
-- （本物のSupabaseにはこれらがすでに存在し、実装も異なる）
-- =========================================

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- auth: users と auth.uid()（Supabaseと同じく、リクエストのJWTのsubを返す）
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- storage: buckets / objects（RLS有効）と storage.foldername()
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
-- Supabaseと同じく、最後の要素（ファイル名）を除いたフォルダの配列を返す
create function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
