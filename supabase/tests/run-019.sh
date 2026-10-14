#!/usr/bin/env bash
# migration 019（closet_activity_events）のローカル自動テスト
# （DockerのPostgres 15を使い捨てで起動する。run-017.sh と同じ仕組み）
#
# - 本番・SupabaseのDBには一切接続しない
# - このスクリプトが起動したコンテナだけを使い、終了時に削除する
# - 019 の前に既存データ（019_before_setup.sql）を入れ、初期作成を確かめる
#
# 実行方法（リポジトリのルートで）:
#   bash supabase/tests/run-019.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
CONTAINER="recloset-migration-test-019-$$"
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

echo "== migrations 001-018 (in order)"
for f in supabase/migrations/0*.sql; do
  num=$(basename "$f" | cut -c1-3)
  [ "$((10#$num))" -le 18 ] || continue
  psql_quiet -f "$f"
done

echo "== existing data (before 019)"
psql_quiet -f supabase/tests/019_before_setup.sql

# 途中で失敗したときに何も残らないこと（commit の直前でわざと失敗させる）
echo "== migration 019 (fails before commit -> nothing remains)"
docker exec "$CONTAINER" sh -c \
  "sed 's/^commit;\$/select 1 \/ 0;\ncommit;/' /supabase/migrations/019_create_closet_activity_events.sql > /tmp/019_fail.sql"
if psql_quiet -f /tmp/019_fail.sql 2>/dev/null; then
  echo "FAIL: injected failure did not stop migration 019"
  exit 1
fi
leftover=$(docker exec "$CONTAINER" psql -X -At -U postgres -d postgres -c \
  "select (to_regclass('public.closet_activity_events') is not null)::int
        + (select count(*) from pg_proc where proname like 'log_%_activity'
             or proname = 'get_closet_activity_kind_day_counts')
        + (select count(*) from pg_trigger where tgname like 'trg_%_log%')")
if [ "$leftover" != "0" ]; then
  echo "FAIL: migration 019 left objects after failure ($leftover)"
  exit 1
fi
echo "ok: 途中で失敗した019は、テーブル・関数・トリガーを何も残さない"

echo "== migration 019"
psql_quiet -f supabase/migrations/019_create_closet_activity_events.sql

# 「5. 既存データからの初期作成」だけを抜き出す（再実行しても二重にならないことの確認用）
docker exec "$CONTAINER" sh -c \
  "sed -n '/^-- 5\\. /,/^-- 6\\. /p' /supabase/migrations/019_create_closet_activity_events.sql > /tmp/019_backfill.sql"

echo "== 019"
run_test supabase/tests/019_closet_activity_events.test.sql
