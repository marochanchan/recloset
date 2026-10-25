-- =========================================
-- Re:Closet: コーデのサマリー作り直しと派生値の関数
--
-- 目的: 事実（コーデ・着用記録）から、月ごとの3つのサマリーと、
-- 服の wear_count / last_worn_at を作り直す内部関数を足す。
-- 関数だけ（テーブル・トリガーは作らない）。
--
-- 方針:
-- - 日付の境界はすべて日本時間（Asia/Tokyo）。月は「日本時間の月」で、その月の1日の date で表す
-- - すべて security definer + search_path 空。テーブル・関数名は public. 付きで書く
-- - 内部用: どのロールにも execute を与えない。呼ぶのは security definer の RPC（022, 023）と、
--   024 の初期集計（SQL Editor の postgres）だけ
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
--   全体を begin〜commit の1トランザクションで実行する。途中で失敗した場合は何も残らない
-- =========================================
begin;

-- ユーザー単位の排他ロック（トランザクションが終わると自動で外れる。同じトランザクション内なら何度でもかけられる）
create or replace function public.outfit_lock_user(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('outfits:' || p_user::text, 0));
$$;

-- 時刻を日本時間の日付にする
create or replace function public.jst_date(p_ts timestamptz)
returns date
language sql
immutable
security definer
set search_path = ''
as $$
  select (p_ts at time zone 'Asia/Tokyo')::date;
$$;

-- コーデの着用日から着用記録の worn_at を決める。日本時間の今日なら now()、過去日はその日の 12:00 JST
create or replace function public.outfit_worn_at(p_worn_on date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_worn_on = public.jst_date(now()) then now()
    else (p_worn_on + time '12:00') at time zone 'Asia/Tokyo'
  end;
$$;

-- 着用記録から wear_count と last_worn_at を数え直す（記録がなければ 0 と null）
create or replace function public.recompute_item_wear(p_item_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clothing_items ci
     set wear_count = (select count(*) from public.wear_logs wl where wl.clothing_item_id = ci.id),
         last_worn_at = (select max(wl.worn_at) from public.wear_logs wl where wl.clothing_item_id = ci.id)
   where ci.id = any(p_item_ids);
$$;

-- そのユーザーの1か月分のサマリー3つを、事実から入れ直す
-- 範囲は日本時間の [p_month, p_month + 1 month)。p_month はその月の1日
create or replace function public.rebuild_monthly_stats(p_user uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_ts timestamptz := p_month::timestamp at time zone 'Asia/Tokyo';
  v_to_ts   timestamptz := (p_month + interval '1 month')::timestamp at time zone 'Asia/Tokyo';
  v_to_date date        := (p_month + interval '1 month')::date;
begin
  delete from public.item_monthly_stats         where user_id = p_user and month = p_month;
  delete from public.item_pair_monthly_stats    where user_id = p_user and month = p_month;
  delete from public.outfit_combo_monthly_stats where user_id = p_user and month = p_month;

  -- 服ごと: 着用記録（wear_log_count・worn_days・last_worn_on）と、確定済みコーデに入った回数。
  -- 着用記録がなくてもコーデに入っている服は行を作る
  insert into public.item_monthly_stats
    (user_id, item_id, month, wear_log_count, worn_days, outfit_count, last_worn_on)
  select p_user,
         coalesce(w.item_id, o.item_id),
         p_month,
         coalesce(w.log_count, 0),
         coalesce(w.days, 0),
         coalesce(o.outfit_count, 0),
         w.last_on
    from (
      select wl.clothing_item_id as item_id,
             count(*) as log_count,
             count(distinct public.jst_date(wl.worn_at)) as days,
             max(public.jst_date(wl.worn_at)) as last_on
        from public.wear_logs wl
        join public.clothing_items ci on ci.id = wl.clothing_item_id
       where ci.user_id = p_user
         and wl.worn_at >= v_from_ts and wl.worn_at < v_to_ts
       group by wl.clothing_item_id
    ) w
    full join (
      select oi.item_id, count(*) as outfit_count
        from public.outfit_items oi
        join public.outfits ot on ot.id = oi.outfit_id
       where ot.user_id = p_user and ot.status = 'confirmed'
         and ot.worn_on >= p_month and ot.worn_on < v_to_date
       group by oi.item_id
    ) o on o.item_id = w.item_id;

  -- 服の組み合わせ: 同じ確定済みコーデの中の2着ずつ（item_a < item_b）
  insert into public.item_pair_monthly_stats
    (user_id, item_a, item_b, month, outfit_count, together_days, last_worn_on)
  select p_user, a.item_id, b.item_id, p_month,
         count(*), count(distinct ot.worn_on), max(ot.worn_on)
    from public.outfits ot
    join public.outfit_items a on a.outfit_id = ot.id
    join public.outfit_items b on b.outfit_id = ot.id and a.item_id < b.item_id
   where ot.user_id = p_user and ot.status = 'confirmed'
     and ot.worn_on >= p_month and ot.worn_on < v_to_date
   group by a.item_id, b.item_id;

  -- コーデ全体の組み合わせ: 服が2着以上の確定済みコーデを、服の集まりでまとめる
  insert into public.outfit_combo_monthly_stats
    (user_id, combo_key, item_ids, month, outfit_count, last_worn_on)
  select p_user, c.combo_key, c.item_ids, p_month, count(*), max(c.worn_on)
    from (
      select ot.id, ot.worn_on,
             md5(string_agg(oi.item_id::text, ',' order by oi.item_id)) as combo_key,
             array_agg(oi.item_id order by oi.item_id) as item_ids
        from public.outfits ot
        join public.outfit_items oi on oi.outfit_id = ot.id
       where ot.user_id = p_user and ot.status = 'confirmed'
         and ot.worn_on >= p_month and ot.worn_on < v_to_date
       group by ot.id, ot.worn_on
      having count(*) >= 2
    ) c
   group by c.combo_key, c.item_ids;
end;
$$;

-- そのユーザーのサマリーを全部消して、着用記録かコーデがある月ぜんぶを入れ直し、服の wear_count も数え直す
create or replace function public.rebuild_all_stats(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
begin
  perform public.outfit_lock_user(p_user);

  delete from public.item_monthly_stats         where user_id = p_user;
  delete from public.item_pair_monthly_stats    where user_id = p_user;
  delete from public.outfit_combo_monthly_stats where user_id = p_user;

  for v_month in
    select date_trunc('month', wl.worn_at at time zone 'Asia/Tokyo')::date
      from public.wear_logs wl
      join public.clothing_items ci on ci.id = wl.clothing_item_id
     where ci.user_id = p_user
    union
    select date_trunc('month', ot.worn_on)::date
      from public.outfits ot
     where ot.user_id = p_user and ot.status = 'confirmed'
  loop
    perform public.rebuild_monthly_stats(p_user, v_month);
  end loop;

  perform public.recompute_item_wear(
    array(select ci.id from public.clothing_items ci where ci.user_id = p_user));
end;
$$;

-- 内部用: どのロールにも execute を与えない（Supabase が自動で付ける分も取り上げる）
revoke all on function public.outfit_lock_user(uuid)           from public, anon, authenticated, service_role;
revoke all on function public.jst_date(timestamptz)            from public, anon, authenticated, service_role;
revoke all on function public.outfit_worn_at(date)             from public, anon, authenticated, service_role;
revoke all on function public.recompute_item_wear(uuid[])      from public, anon, authenticated, service_role;
revoke all on function public.rebuild_monthly_stats(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.rebuild_all_stats(uuid)          from public, anon, authenticated, service_role;

commit;
