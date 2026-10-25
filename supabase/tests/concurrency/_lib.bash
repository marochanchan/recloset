# 同時実行のテストの共通の関数（run-outfits.sh から bash "$t" で動かされる各 *.sh が source する）
# 前提: 環境変数 CONTAINER = run-outfits.sh が起動した使い捨てコンテナ名
#
# 進め方（3つのテストで共通）:
#   1. 接続1を裏で動かす（begin; 操作1; pg_sleep(3); commit;）
#   2. pg_locks で接続1が advisory lock を持ったことを確かめてから、接続2を裏で始める（最大5秒待つ）
#   3. 接続2が pg_stat_activity でロック待ち（wait_event_type = 'Lock'）になったことを確かめる
#   4. 両方が終わったら、postgres で結果を確かめる
# 失敗したら fail を呼ぶ。exit 1 で終わり、親（run-outfits.sh）が非ゼロを見て止まる

C='cccccccc-0000-4000-8000-00000000000c'
C_ITEM1='c1c1c1c1-0000-4000-8000-0000000000d1'
C_ITEM2='c2c2c2c2-0000-4000-8000-0000000000d2'

: "${CONTAINER:?CONTAINER is required (run via run-outfits.sh)}"

pg() { docker exec -i -w / "$CONTAINER" psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

fail() { echo "FAIL: $1"; exit 1; }

# ユーザー C の committed データを空にする（テスト間で持ち越さない）
reset_c() {
  pg <<SQL >/dev/null
delete from public.outfits where user_id = '$C';
delete from public.wear_logs where clothing_item_id in (select id from public.clothing_items where user_id = '$C');
delete from public.item_monthly_stats where user_id = '$C';
delete from public.item_pair_monthly_stats where user_id = '$C';
delete from public.outfit_combo_monthly_stats where user_id = '$C';
update public.clothing_items set wear_count = 0, last_worn_at = null where user_id = '$C';
SQL
}

# C として RPC を呼ぶ接続の SQL（$1 = 本体の SQL）。接続1は最後に pg_sleep して commit を遅らせる
conn_sql() {
  local body="$1" sleep_sql="${2:-}"
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$C', true);
do \$\$ begin
  if current_user <> 'authenticated' or auth.uid() is distinct from '$C'::uuid then
    raise exception 'FAIL: wrong identity %, %', current_user, auth.uid();
  end if;
end \$\$;
$body
$sleep_sql
commit;
SQL
}

# 接続1が advisory lock を持つまで待つ（最大5秒）
wait_for_lock() {
  for _ in $(seq 1 50); do
    if [ "$(pg -c "select count(*) from pg_locks where locktype = 'advisory' and granted")" -ge 1 ]; then
      return 0
    fi
    sleep 0.1
  done
  fail "connection 1 never acquired the advisory lock"
}

# 接続2がロック待ちになるまで待つ（最大5秒）
wait_for_blocked() {
  for _ in $(seq 1 50); do
    if [ "$(pg -c "select count(*) from pg_stat_activity
                    where wait_event_type = 'Lock' and wait_event = 'advisory'
                      and query like '%confirm_outfit%'")" -ge 1 ]; then
      return 0
    fi
    sleep 0.1
  done
  fail "connection 2 was not waiting on the advisory lock"
}

# 2接続を動かす。$1 = 接続1の本体の SQL、$2 = 接続2の本体の SQL。結果は $OUT1 / $OUT2
run_two() {
  OUT1=$(mktemp); OUT2=$(mktemp)
  conn_sql "$1" "select pg_sleep(3);" | pg >"$OUT1" 2>&1 &
  P1=$!
  wait_for_lock
  conn_sql "$2" | pg >"$OUT2" 2>&1 &
  P2=$!
  wait_for_blocked
  local rc=0
  wait "$P1" || { cat "$OUT1"; fail "connection 1 failed"; }
  wait "$P2" || { cat "$OUT2"; fail "connection 2 failed"; }
}
