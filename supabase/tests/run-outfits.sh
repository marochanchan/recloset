#!/usr/bin/env bash
# コーデ機能（migration 020〜024）のローカル自動テスト
# （DockerのPostgres 15を使い捨てで起動する。run-019.sh と同じ仕組み）
#
# - 本番・SupabaseのDBには一切接続しない
# - このスクリプトが起動したコンテナだけを使い、終了時に削除する
# - migrations/02[0-9]_*.sql と tests/02[0-9]_*.test.sql は、存在するものを番号順に自動で拾う
#
# 実行方法（リポジトリのルートで）:
#   bash supabase/tests/run-outfits.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
CONTAINER="recloset-migration-test-outfits-$$"
IMAGE="postgres:15-alpine"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

docker cp supabase "$CONTAINER":/work-supabase >/dev/null
docker exec "$CONTAINER" ln -sfn /work-supabase /supabase
psql_run() {
  docker exec -w / "$CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}
psql_quiet() {
  docker exec -w / -e PGOPTIONS="-c client_min_messages=warning" "$CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@" >/dev/null
}
# テスト結果（NOTICE）を表示し、失敗（FAIL・ERROR・終了コード）があれば止める
run_test() {
  local out
  if ! out=$(psql_run -f "$1" 2>&1); then
    echo "$out"
    echo "FAIL: $1"
    exit 1
  fi
  echo "$out" | grep -E "ok|PASSED" | sed 's/^psql:[^ ]* NOTICE:  //'
}

echo "== stub (auth/storage/roles)"
psql_run -f supabase/tests/supabase_stub.sql >/dev/null

echo "== migrations 001-019 (in order)"
for f in supabase/migrations/0*.sql; do
  num=$(basename "$f" | cut -c1-3)
  [ "$((10#$num))" -le 19 ] || continue
  psql_quiet -f "$f"
done

echo "== existing data (before 020)"
psql_quiet -f supabase/tests/020_before_setup.sql

# Supabase の既定の権限をいちばん広い形でまねる（stub は変えない）。
# migration 側の取り上げ忘れを、権限のテストで見つけるため
echo "== emulate Supabase default privileges"
psql_quiet -c "
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;"

# 途中で失敗したときに何も残らないこと（commit の直前でわざと失敗させる）
echo "== migration 020 (fails before commit -> nothing remains)"
docker exec "$CONTAINER" sh -c \
  "sed 's/^commit;\$/select 1 \/ 0;\ncommit;/' /supabase/migrations/020_create_outfit_schema.sql > /tmp/020_fail.sql"
if psql_quiet -f /tmp/020_fail.sql 2>/dev/null; then
  echo "FAIL: injected failure did not stop migration 020"
  exit 1
fi
leftover=$(docker exec "$CONTAINER" psql -X -At -U postgres -d postgres -c \
  "select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('outfits','outfit_items','outfit_media','item_monthly_stats',
                                'item_pair_monthly_stats','outfit_combo_monthly_stats','media_deletion_queue'))
        + (select count(*) from information_schema.columns
            where table_schema = 'public'
              and ((table_name = 'clothing_items' and column_name = 'archived_at')
                or (table_name = 'wear_logs' and column_name = 'source')))
        + (select count(*) from pg_constraint
            where conname in ('clothing_items_id_user_id_key','wear_logs_id_clothing_item_id_key'))")
if [ "$leftover" != "0" ]; then
  echo "FAIL: migration 020 left objects after failure ($leftover)"
  exit 1
fi
echo "ok: 途中で失敗した020は、テーブル・列・制約を何も残さない"

echo "== migrations 020-029 (existing ones, in order)"
for f in supabase/migrations/02[0-9]_*.sql; do
  [ -e "$f" ] || continue
  echo "-- $(basename "$f")"
  psql_quiet -f "$f"
done

echo "== test helpers"
psql_quiet -f supabase/tests/outfits_test_helpers.sql

for t in supabase/tests/02[0-9]_*.test.sql; do
  [ -e "$t" ] || continue
  echo "== $(basename "$t")"
  run_test "$t"
done

# 同時実行のテスト（Task 6b 以降で足す。コミット済みのユーザー C のデータに対して最後に動かす）
for t in supabase/tests/02[0-9]_*.concurrency.sh; do
  [ -e "$t" ] || continue
  echo "== $(basename "$t")"
  # shellcheck disable=SC1090
  source "$t"
done
