#!/usr/bin/env bash
# 接続1: claim_media_deletions(2) をして commit を遅らせる。接続2: その間に claim_media_deletions(10)
# → for update skip locked なので接続2は待たず、接続1が掴んだ行を取らない（重ならず、どちらも1件以上返す）
set -euo pipefail
source "$(dirname "$0")/_lib.bash"

reset_c
pg -c "delete from public.media_deletion_queue"
pg -c "insert into public.media_deletion_queue (user_id, provider, provider_asset_id)
       select '$C', 'cf_images', 'conc-' || g from generate_series(1, 4) g"

claim_sql() { # $1 = limit, $2 = 出力のあとに入れる sleep
  cat <<SQL
begin;
set local role service_role;
do \$\$ begin
  if current_user <> 'service_role' then raise exception 'FAIL: wrong identity %', current_user; end if;
end \$\$;
select 'ids=' || coalesce(string_agg(id::text, ',' order by id), '') from public.claim_media_deletions($1);
$2
commit;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
claim_sql 2 "select pg_sleep(3);" | pg >"$OUT1" 2>&1 &
P1=$!
# 接続1が行を掴む（リースが書かれる）まで待つ。commit 前は他の接続からは見えないので、
# 行ロックを持つ接続が sleep 中であることを pg_stat_activity で確かめる
for _ in $(seq 1 50); do
  [ "$(pg -c "select count(*) from pg_stat_activity where query like '%pg_sleep(3)%' and state = 'active' and pid <> pg_backend_pid()")" -ge 1 ] && break
  sleep 0.1
done
claim_sql 10 "" | pg >"$OUT2" 2>&1 &
P2=$!
wait "$P1" || { cat "$OUT1"; fail "connection 1 failed"; }
wait "$P2" || { cat "$OUT2"; fail "connection 2 failed"; }

ids1=$(grep '^ids=' "$OUT1" | sed 's/^ids=//' | tr ',' '\n' | sed '/^$/d' | sort)
ids2=$(grep '^ids=' "$OUT2" | sed 's/^ids=//' | tr ',' '\n' | sed '/^$/d' | sort)
n1=$(printf '%s\n' "$ids1" | sed '/^$/d' | wc -l | tr -d ' ')
n2=$(printf '%s\n' "$ids2" | sed '/^$/d' | wc -l | tr -d ' ')
[ "$n1" -ge 1 ] || { cat "$OUT1"; fail "connection 1 should have claimed rows"; }
[ "$n2" -ge 1 ] || { cat "$OUT2"; fail "connection 2 should have claimed rows"; }
dup=$(comm -12 <(printf '%s\n' "$ids1") <(printf '%s\n' "$ids2") | sed '/^$/d' | wc -l | tr -d ' ')
[ "$dup" = "0" ] || fail "the same row was claimed twice ($dup)"
[ "$((n1 + n2))" = "4" ] || fail "all 4 rows should be claimed in total (got: $((n1 + n2)))"

pg -c "delete from public.media_deletion_queue"
reset_c
echo "ok: 2つの接続から同時に claim しても、同じ削除待ちの行を二重に返さない"
