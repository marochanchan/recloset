#!/usr/bin/env bash
# 接続1: C が record_wear_today(T)。接続2: C が T を含む今日のコーデを confirm_outfit
# → 順番に処理され、T の今日の記録は1件だけで、コーデにつながり、wear_count が記録の件数と同じ
set -euo pipefail
source "$(dirname "$0")/_lib.bash"

reset_c
O='cccc0003-0000-4000-8000-000000000001'
TODAY=$(pg -c "select public.jst_date(now())")
pg <<SQL
insert into public.outfits (id, user_id, worn_on, source) values ('$O', '$C', '$TODAY', 'upload');
SQL

run_two \
  "select public.record_wear_today('$C_ITEM1');" \
  "select public.confirm_outfit('$O', 0, '$TODAY', array['$C_ITEM1']::uuid[], null);"

grep -q '"created": true' "$OUT1" || { cat "$OUT1"; fail "connection 1 should have created the wear_today log"; }
grep -q '"status": "confirmed"' "$OUT2" || { cat "$OUT2"; fail "connection 2 should be confirmed"; }

total=$(pg -c "select count(*) from public.wear_logs where clothing_item_id = '$C_ITEM1'")
linked=$(pg -c "select count(*) from public.outfit_items oi join public.wear_logs wl on wl.id = oi.wear_log_id
                 where oi.outfit_id = '$O' and wl.clothing_item_id = '$C_ITEM1'")
wc=$(pg -c "select wear_count from public.clothing_items where id = '$C_ITEM1'")
[ "$total" = "1" ] || fail "exactly one wear log expected (got: $total)"
[ "$linked" = "1" ] || fail "the log should be linked to the outfit (got: $linked)"
[ "$wc" = "$total" ] || fail "wear_count ($wc) should equal the number of logs ($total)"

src=$(pg -c "select wl.source from public.wear_logs wl
              where wl.clothing_item_id = '$C_ITEM1' and public.jst_date(wl.worn_at) = '$TODAY'")
[ "$src" = "wear_today" ] || fail "the single log should be source=wear_today (got: $src)"
lsrc=$(pg -c "select wl.source from public.outfit_items oi join public.wear_logs wl on wl.id = oi.wear_log_id
               where oi.outfit_id = '$O' and oi.item_id = '$C_ITEM1'")
[ "$lsrc" = "wear_today" ] || fail "the linked log should be the wear_today one (got: $lsrc)"

check_invariants "$O" "$TODAY" "$C_ITEM1"

reset_c
echo "ok: 同時に「今日着た」と確定をしても、記録が二重にならない"
