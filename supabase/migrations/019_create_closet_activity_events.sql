-- =========================================
-- Re:Closet: 行動履歴（public.closet_activity_events）
--
-- 目的: 登録・着用・見直し・整理・循環の行動を、服や元の記録を削除しても消えない
-- 追記型の履歴として残す。Re:Garden（成長）と、将来のRe:Story（振り返り）で共通に使う。
--
-- 方針:
-- - 1行＝1回の行動。kind は成長の種類（register / wear / review / organize / circulate）、
--   action は具体的な行動（下の CHECK 制約を参照）
-- - clothing_item_id は on delete set null。服を削除しても行動の行は残る
--   （元の記録＝wear_logs などは従来どおり cascade で消えるが、この表は残る）
-- - occurred_at: トリガーで記録する行動は、記録した時刻（now()）。
--   クライアントが送る created_at などの値は使わない（日付を偽って成長させないため）。
--   既存データからの初期作成（5.）だけは、元の記録の時刻を使う
-- - 成長ポイント（Re:Garden）は「日本時間の1日 × kind」で1pt（6.のRPCで数える）。
--   同じ日に同じ種類の行動を何回しても1pt（大量登録・連続操作で稼げない）
--
-- DBトリガーを使う理由（「カウンタ更新にDBトリガーを使わない」方針の限定的な例外）:
-- - 行動の保存はブラウザ（登録・スワイプ見直し・仕分け）と Server Action（着用・AI診断・
--   状態変更）に分かれている。アプリ側で行動履歴を書くと、通信の失敗などで欠落する
--   うえ、ブラウザから行動履歴を直接書ける（改ざんできる）ようにする必要がある
-- - トリガーなら元の記録と同じトランザクションで記録され、既存の保存処理も変えずに済む
-- - 例外はこの表への記録だけ。既存の列の値をトリガーで書き換えることはしない
-- - 行動履歴の記録に失敗しても、元の保存（登録・着用など）は失敗させない。
--   トリガー関数の中で例外を受け止め、WARNING をログに出して続行する
--   （行動履歴は補助的な記録のため、服の保存を優先する。欠落はログで確認できる）
--
-- 重複防止（dedupe_key の一意制約。INSERT と UPDATE で作り方を分ける）:
-- - INSERT由来（登録・着用・AI診断・スワイプ見直し）: 元の行のID
--   （例 'wear_logs:<id>'）。1つの行から行動は1つだけ
-- - UPDATE由来（同じ服で何度も起こり得る: 状態変更・カテゴリ・季節の仕分け）:
--   重複の判定は「値が実際に変わったか」（old と new の比較）で行い、変わったときだけ記録する。
--   source_table/source_id だけでは一意にしない
--   - 状態変更・季節: キーの末尾は gen_random_uuid()（例 'clothing_items:<id>:status:sold:<uuid>'）。
--     同じトランザクション内・同時刻の正当な変更も、それぞれ1件として記録される
--   - カテゴリ: category_classified_at の値をキーにする（初期作成と同じキーになり、
--     同じ値の再保存・初期作成とトリガーで二重にならない）
-- - どの記録も on conflict (dedupe_key) do nothing。同時実行でも一意制約違反のエラーにはならない
-- - 初期作成（5.）は on conflict do nothing。単独で再実行しても二重にならない
--
-- 取り消し（スワイプの「1つ前に戻す」「最後の判断をやり直す」）:
-- - アプリは判断の行（closet_review_decisions）を削除する（既存の動きは変えない）
-- - 削除されたとき、その判断の行動に revoked_at を記録する（行は消さない）。
--   revoked_at のある行動は成長ポイントに数えない
-- - 服の削除による cascade で判断が消えた場合は、取り消しではないため記録しない
--   （服がまだ存在するときだけ revoked_at を記録する）
--
-- 権限:
-- - RLS: 本人（user_id = auth.uid()）の行だけ SELECT できる
-- - GRANT: anon・PUBLICには何も与えない。authenticated には SELECT だけ。
--   INSERT/UPDATE/DELETE のポリシー・GRANTは作らない（クライアントから直接は書けない）
-- - 書き込むのは security definer のトリガー関数だけ。search_path は '' に固定し、
--   すべて schema 付きで参照する。user_id は対象の服（clothing_items）の所有者から導く
--
-- 既存データ: 既存テーブルのデータは変更しない。5.で既存の登録・着用・AI診断・
-- スワイプ見直し（skip除く）・カテゴリの仕分け（category_classified_at）から行動を作る。
-- 既に削除された服の記録、過去の状態変更、季節を付けた日時は記録がないため作らない（推測しない）
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
--   全体を begin〜commit の1トランザクションで実行する。途中で失敗した場合は何も残らない
--   （テーブル・関数・トリガー・初期作成のすべてが取り消される）。
--   順序: テーブル → トリガー関数 → トリガー → 初期作成。トリガーの作成で対象の表への
--   書き込みは commit まで待たされるため、トリガー作成〜初期作成の間に行動が漏れたり、
--   二重になったりしない。ロック待ちが長引かないよう lock_timeout を10秒にする
--   （待ちきれなければ全体が失敗して取り消されるので、時間をおいて再実行する）
-- 注意: このファイルはまだSupabaseに実行していません。
-- 前提: 001〜018 が適用済みであること。
-- テスト: bash supabase/tests/run-019.sh（ローカルのDockerのPostgres）
-- 既存migration (001-018) は変更していません。
-- =========================================

begin;

set local lock_timeout = '10s';

-- -----------------------------------------
-- 1. テーブル
-- -----------------------------------------
create table public.closet_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  action text not null,
  clothing_item_id uuid references public.clothing_items(id) on delete set null,
  occurred_at timestamptz not null,
  source_table text not null,
  source_id uuid not null,
  dedupe_key text not null,
  detail jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint closet_activity_events_dedupe_key_unique unique (dedupe_key),
  constraint closet_activity_events_kind_action_check check (
    (kind = 'register' and action = 'item_registered')
    or (kind = 'wear' and action = 'wear_logged')
    or (kind = 'review' and action in ('ai_diagnosis', 'swipe_review'))
    or (kind = 'organize'
        and action in ('category_classified', 'seasons_classified', 'status_candidate'))
    or (kind = 'circulate' and action in ('status_letting_go', 'status_sold'))
  ),
  constraint closet_activity_events_source_table_check check (
    source_table in ('clothing_items', 'wear_logs', 'ai_diagnoses', 'closet_review_decisions')
  )
);

comment on table public.closet_activity_events is
  '行動履歴（追記型）。DBトリガーだけが書き込む。服や元の記録を削除しても残る。
   Re:Garden（日本時間の1日×kindで1pt）とRe:Storyで使う。';
comment on column public.closet_activity_events.kind is
  '成長の種類: register=登録 / wear=着用 / review=見直し / organize=整理（仕分け・手放し候補） / circulate=循環（出品中・売却済み）';
comment on column public.closet_activity_events.clothing_item_id is
  '対象の服。服を削除すると null になる（行動の行は残る）';
comment on column public.closet_activity_events.occurred_at is
  '行動した時刻。トリガーは記録時の now()、既存データからの初期作成は元の記録の時刻';
comment on column public.closet_activity_events.dedupe_key is
  '重複防止のキー。INSERT由来（登録・着用・AI診断・スワイプ見直し）は元のレコードのID。
   UPDATE由来は行動に応じて、カテゴリの仕分けは category_classified_at の値、
   状態変更・季節の仕分けはランダムなUUID（gen_random_uuid()）を含む';
comment on column public.closet_activity_events.revoked_at is
  '取り消された時刻（スワイプの判断を戻したとき）。nullでない行動は成長ポイントに数えない';

-- 本人の行動を新しい順に読む（Re:Story・集計）
create index idx_closet_activity_events_user_id_occurred_at
  on public.closet_activity_events (user_id, occurred_at desc);
-- clothing_items 削除時（on delete set null）の検索用
create index idx_closet_activity_events_clothing_item_id
  on public.closet_activity_events (clothing_item_id)
  where clothing_item_id is not null;

-- -----------------------------------------
-- 2. RLS・GRANT
-- -----------------------------------------
alter table public.closet_activity_events enable row level security;

create policy "closet_activity_events_select_own"
  on public.closet_activity_events for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT/UPDATE/DELETE のポリシーは作らない（GRANTもしない）

revoke all on table public.closet_activity_events from public, anon, authenticated;
grant select on table public.closet_activity_events to authenticated;

-- -----------------------------------------
-- 3. トリガー関数（security definer。search_path固定、schema付きで参照）
--    行動履歴の記録に失敗しても、元の保存は失敗させない（WARNINGを出して続行）
-- -----------------------------------------

-- clothing_items: 登録（INSERT）、状態変更・カテゴリ・季節の仕分け（UPDATE）
create function public.log_clothing_item_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.closet_activity_events
        (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id, dedupe_key)
      values
        (new.user_id, 'register', 'item_registered', new.id, now(), 'clothing_items', new.id,
         'clothing_items:' || new.id || ':registered')
      on conflict (dedupe_key) do nothing;
      return null;
    end if;

    -- 以下は UPDATE。値が実際に変わったときだけ記録する
    if new.status is distinct from old.status
       and new.status in ('candidate', 'letting_go', 'sold') then
      insert into public.closet_activity_events
        (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
         dedupe_key, detail)
      values
        (new.user_id,
         case when new.status = 'candidate' then 'organize' else 'circulate' end,
         'status_' || new.status, new.id, now(), 'clothing_items', new.id,
         'clothing_items:' || new.id || ':status:' || new.status || ':' || gen_random_uuid(),
         jsonb_build_object('from_status', old.status, 'to_status', new.status))
      on conflict (dedupe_key) do nothing;
    end if;

    if new.category_classified_at is not null
       and new.category_classified_at is distinct from old.category_classified_at then
      insert into public.closet_activity_events
        (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
         dedupe_key, detail)
      values
        (new.user_id, 'organize', 'category_classified', new.id, now(), 'clothing_items', new.id,
         'clothing_items:' || new.id || ':category_classified:'
           || to_char(new.category_classified_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
         jsonb_build_object('category', new.category))
      on conflict (dedupe_key) do nothing;
    end if;

    -- 季節: 未設定（空配列）から設定されたときだけ（設定済みの季節の変更は数えない）
    if cardinality(old.seasons) = 0 and cardinality(new.seasons) > 0 then
      insert into public.closet_activity_events
        (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
         dedupe_key, detail)
      values
        (new.user_id, 'organize', 'seasons_classified', new.id, now(), 'clothing_items', new.id,
         'clothing_items:' || new.id || ':seasons_classified:' || gen_random_uuid(),
         jsonb_build_object('seasons', to_jsonb(new.seasons)))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'closet_activity_events: failed to log clothing_items % (%): %',
      tg_op, new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- wear_logs: 着用記録（user_id は服の所有者から導く）
create function public.log_wear_log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.closet_activity_events
      (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id, dedupe_key)
    select i.user_id, 'wear', 'wear_logged', new.clothing_item_id, now(), 'wear_logs', new.id,
           'wear_logs:' || new.id
    from public.clothing_items i
    where i.id = new.clothing_item_id
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'closet_activity_events: failed to log wear_logs (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- ai_diagnoses: AI診断（user_id は服の所有者から導く）
create function public.log_ai_diagnosis_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.closet_activity_events
      (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
       dedupe_key, detail)
    select i.user_id, 'review', 'ai_diagnosis', new.clothing_item_id, now(), 'ai_diagnoses', new.id,
           'ai_diagnoses:' || new.id, jsonb_build_object('decision', new.decision)
    from public.clothing_items i
    where i.id = new.clothing_item_id
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'closet_activity_events: failed to log ai_diagnoses (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- closet_review_decisions: スワイプ見直し（INSERT、skip除く）と取り消し（DELETE）
create function public.log_review_decision_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.decision <> 'skip' then
        insert into public.closet_activity_events
          (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
           dedupe_key, detail)
        select i.user_id, 'review', 'swipe_review', new.clothing_item_id, now(),
               'closet_review_decisions', new.id, 'closet_review_decisions:' || new.id,
               jsonb_build_object('decision', new.decision, 'session_id', new.session_id)
        from public.clothing_items i
        where i.id = new.clothing_item_id
        on conflict (dedupe_key) do nothing;
      end if;
      return null;
    end if;

    -- DELETE: 取り消し。服の削除（cascade）で消えた場合は、服が見えないため記録しない
    if exists (select 1 from public.clothing_items i where i.id = old.clothing_item_id) then
      update public.closet_activity_events
      set revoked_at = now()
      where dedupe_key = 'closet_review_decisions:' || old.id
        and revoked_at is null;
    end if;
  exception when others then
    raise warning 'closet_activity_events: failed to log closet_review_decisions % (%): %',
      tg_op, case when tg_op = 'DELETE' then old.id else new.id end, sqlerrm;
  end;
  return null;
end;
$$;

-- トリガー関数は直接呼ばせない
revoke all on function public.log_clothing_item_activity() from public, anon, authenticated;
revoke all on function public.log_wear_log_activity() from public, anon, authenticated;
revoke all on function public.log_ai_diagnosis_activity() from public, anon, authenticated;
revoke all on function public.log_review_decision_activity() from public, anon, authenticated;

-- -----------------------------------------
-- 4. トリガー
-- -----------------------------------------
create trigger trg_clothing_items_log_insert
  after insert on public.clothing_items
  for each row execute function public.log_clothing_item_activity();

create trigger trg_clothing_items_log_update
  after update of status, category_classified_at, seasons on public.clothing_items
  for each row execute function public.log_clothing_item_activity();

create trigger trg_wear_logs_log_insert
  after insert on public.wear_logs
  for each row execute function public.log_wear_log_activity();

create trigger trg_ai_diagnoses_log_insert
  after insert on public.ai_diagnoses
  for each row execute function public.log_ai_diagnosis_activity();

create trigger trg_closet_review_decisions_log
  after insert or delete on public.closet_review_decisions
  for each row execute function public.log_review_decision_activity();

-- -----------------------------------------
-- 5. 既存データからの初期作成（既存テーブルは変更しない。単独で再実行しても二重にならない）
--    detail.backfilled = true で、トリガーで記録した行動と区別できる
-- -----------------------------------------
insert into public.closet_activity_events
  (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
   dedupe_key, detail)
select i.user_id, 'register', 'item_registered', i.id, i.created_at, 'clothing_items', i.id,
       'clothing_items:' || i.id || ':registered', '{"backfilled": true}'::jsonb
from public.clothing_items i
on conflict (dedupe_key) do nothing;

insert into public.closet_activity_events
  (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
   dedupe_key, detail)
select i.user_id, 'wear', 'wear_logged', w.clothing_item_id, w.worn_at, 'wear_logs', w.id,
       'wear_logs:' || w.id, '{"backfilled": true}'::jsonb
from public.wear_logs w
join public.clothing_items i on i.id = w.clothing_item_id
on conflict (dedupe_key) do nothing;

insert into public.closet_activity_events
  (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
   dedupe_key, detail)
select i.user_id, 'review', 'ai_diagnosis', d.clothing_item_id, d.created_at, 'ai_diagnoses', d.id,
       'ai_diagnoses:' || d.id,
       jsonb_build_object('decision', d.decision, 'backfilled', true)
from public.ai_diagnoses d
join public.clothing_items i on i.id = d.clothing_item_id
on conflict (dedupe_key) do nothing;

insert into public.closet_activity_events
  (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
   dedupe_key, detail)
select i.user_id, 'review', 'swipe_review', r.clothing_item_id, r.created_at,
       'closet_review_decisions', r.id, 'closet_review_decisions:' || r.id,
       jsonb_build_object('decision', r.decision, 'session_id', r.session_id, 'backfilled', true)
from public.closet_review_decisions r
join public.clothing_items i on i.id = r.clothing_item_id
where r.decision <> 'skip'
on conflict (dedupe_key) do nothing;

insert into public.closet_activity_events
  (user_id, kind, action, clothing_item_id, occurred_at, source_table, source_id,
   dedupe_key, detail)
select i.user_id, 'organize', 'category_classified', i.id, i.category_classified_at,
       'clothing_items', i.id,
       'clothing_items:' || i.id || ':category_classified:'
         || to_char(i.category_classified_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
       jsonb_build_object('category', i.category, 'backfilled', true)
from public.clothing_items i
where i.category_classified_at is not null
on conflict (dedupe_key) do nothing;

-- -----------------------------------------
-- 6. 集計RPC（Re:Garden）: kind ごとの「行動した日数」（日本時間、取り消し済みを除く）
--    security invoker（RLSが効く）に加え、本人の行だけに明示的に絞る
-- -----------------------------------------
create function public.get_closet_activity_kind_day_counts()
returns table (kind text, day_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.kind,
         count(distinct (e.occurred_at at time zone 'Asia/Tokyo')::date)::integer
  from public.closet_activity_events e
  where e.user_id = (select auth.uid())
    and e.revoked_at is null
  group by e.kind
  order by e.kind;
$$;

revoke all on function public.get_closet_activity_kind_day_counts() from public, anon, authenticated;
grant execute on function public.get_closet_activity_kind_day_counts() to authenticated;

notify pgrst, 'reload schema';

commit;
