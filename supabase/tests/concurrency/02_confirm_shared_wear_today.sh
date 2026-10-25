#!/usr/bin/env bash
# 同じ日の別々のコーデ2つに、未使用の wear_today がある服 T を入れて同時に確定する
# → 一意制約のエラーにならず、wear_today は片方だけにつながり、もう片方は source=outfit の記録になる
set -euo pipefail
source "$(dirname "$0")/_lib.bash"

reset_c
O1='cccc0002-0000-4000-8000-000000000001'
O2='cccc0002-0000-4000-8000-000000000002'
W='cccc0002-0000-4000-8000-0000000000aa'
pg <<SQL
insert into public.outfits (id, user_id, worn_on, source)
values ('$O1', '$C', '2025-10-31', 'upload'), ('$O2', '$C', '2025-10-31', 'upload');
insert into public.wear_logs (id, clothing_item_id, worn_at, source)
values ('$W', '$C_ITEM1', '2025-10-31 09:00+09', 'wear_today');
SQL

run_two \
  "select public.confirm_outfit('$O1', 0, '2025-10-31', array['$C_ITEM1']::uuid[], null);" \
  "select public.confirm_outfit('$O2', 0, '2025-10-31', array['$C_ITEM1']::uuid[], null);"

grep -q '"status": "confirmed"' "$OUT1" || { cat "$OUT1"; fail "connection 1 should be confirmed"; }
grep -q '"status": "confirmed"' "$OUT2" || { cat "$OUT2"; fail "connection 2 should be confirmed"; }

l1=$(pg -c "select wear_log_id from public.outfit_items where outfit_id = '$O1'")
l2=$(pg -c "select wear_log_id from public.outfit_items where outfit_id = '$O2'")
src2=$(pg -c "select source from public.wear_logs where id = '$l2'")
total=$(pg -c "select count(*) from public.wear_logs where clothing_item_id = '$C_ITEM1'")
[ "$l1" = "$W" ] || fail "first outfit should use the wear_today log (got: $l1)"
[ "$l2" != "$W" ] && [ -n "$l2" ] || fail "second outfit must not share the wear_today log (got: $l2)"
[ "$src2" = "outfit" ] || fail "second outfit's log should be source=outfit (got: $src2)"
[ "$total" = "2" ] || fail "two wear logs expected (got: $total)"

reset_c
echo "ok: 同時に確定しても、同じ記録を2つのコーデで使わない"
