#!/usr/bin/env bash
# migration 017（user_habit_settings）のローカル自動テスト
# （DockerのPostgres 15を使い捨てで起動する。run-016.sh と同じ仕組み）
#
# - 本番・SupabaseのDBには一切接続しない
# - このスクリプトが起動したコンテナだけを使い、終了時に削除する
#
# 実行方法（リポジトリのルートで）:
#   bash supabase/tests/run-017.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
CONTAINER="recloset-migration-test-017-$$"
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

echo "== migrations 001-017 (in order)"
for f in supabase/migrations/0*.sql; do
  num=$(basename "$f" | cut -c1-3)
  [ "$((10#$num))" -le 17 ] || continue
  docker exec -w / -e PGOPTIONS="-c client_min_messages=warning" "$CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" >/dev/null
done

echo "== 017"
run_test supabase/tests/017_user_habit_settings.test.sql
