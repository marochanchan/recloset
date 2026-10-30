#!/usr/bin/env bash
# 同じコーデを、どちらも expected 0 で、違う服の集合で同時に確定する
# → 片方は {confirmed, 1}、もう片方は {stale, 1}
set -euo pipefail
source "$(dirname "$0")/_lib.bash"

reset_c
O='cccc0001-0000-4000-8000-000000000001'
pg -c "insert into public.outfits (id, user_id, worn_on, source) values ('$O', '$C', '2025-10-31', 'upload')"

run_two \
  "select public.confirm_outfit('$O', 0, '2025-10-31', array['$C_ITEM1']::uuid[], null);" \
  "select public.confirm_outfit('$O', 0, '2025-10-31', array['$C_ITEM2']::uuid[], null);"

grep -q '"status": "confirmed", "revision": 1' "$OUT1" || { cat "$OUT1"; fail "connection 1 should be confirmed"; }
grep -q '"status": "stale", "revision": 1' "$OUT2" || { cat "$OUT2"; fail "connection 2 should be stale"; }

items=$(pg -c "select string_agg(item_id::text, ',' order by item_id) from public.outfit_items where outfit_id = '$O'")
rev=$(pg -c "select revision from public.outfits where id = '$O'")
logs=$(pg -c "select count(*) from public.wear_logs where clothing_item_id in ('$C_ITEM1', '$C_ITEM2')")
[ "$items" = "$C_ITEM1" ] || fail "outfit_items should be only the first confirmed set (got: $items)"
[ "$rev" = "1" ] || fail "revision should be 1 (got: $rev)"
[ "$logs" = "1" ] || fail "exactly one wear log expected (got: $logs)"

check_invariants "$O" 2025-10-31 "$C_ITEM1"

reset_c
echo "ok: 同時に確定しても、あとの方は stale になる"
