#!/usr/bin/env bash
# migration 016 のローカル自動テスト（DockerのPostgres 15を使い捨てで起動）
#
# - 本番・SupabaseのDBには一切接続しない
# - このスクリプトが起動したコンテナだけを使い、終了時に削除する
#
# 実行方法（リポジトリのルートで）:
#   bash supabase/tests/run-016.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
CONTAINER="recloset-migration-test-$$"
IMAGE="postgres:15-alpine"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

# リポジトリのsupabaseディレクトリをコンテナへコピーして実行する
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

echo "== migrations 001-015"
for f in supabase/migrations/0*.sql; do
  # 016より前（001〜015）だけを適用する。017以降は016の後に作られたもので、
  # 修正前の状態の再現（016_before.test.sql）には含めない
  num=$(basename "$f" | cut -c1-3)
  [ "$((10#$num))" -lt 16 ] || continue
  docker exec -w / -e PGOPTIONS="-c client_min_messages=warning" "$CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" >/dev/null
done

echo "== before 016 (reproduce the vulnerability)"
run_test supabase/tests/016_before.test.sql

echo "== read-only check SQL (before 016)"
CHECK_OUT=$(psql_run -f supabase/sql/016_clothing_image_path_owner_check.sql 2>&1)
echo "$CHECK_OUT" | grep -q "bbbbbbbb-0000-4000-8000-00000000000b/b1b1b1b1" \
  && echo "ok: check SQL lists the mismatched row" \
  || { echo "FAIL: check SQL did not list the mismatched row"; echo "$CHECK_OUT"; exit 1; }

echo "== migration 016 (applied twice to confirm it is re-runnable)"
psql_run -f supabase/migrations/016_enforce_clothing_image_path_owner.sql >/dev/null
psql_run -f supabase/migrations/016_enforce_clothing_image_path_owner.sql >/dev/null

echo "== read-only check SQL (after 016)"
psql_run -f supabase/sql/016_clothing_image_path_owner_check.sql >/dev/null && echo "ok: check SQL runs after 016"

echo "== after 016"
run_test supabase/tests/016_after.test.sql

echo "== check SQL (query 1) matches the migration's function"
# 判定表と同じ種類のパスを不整合データとして直接投入し（postgres権限・RLS対象外）、
# 確認用SQLのクエリ1と、016の関数による件数が一致することを確かめる
psql_run -f supabase/tests/016_consistency_setup.sql >/dev/null
Q1=$(sed -n '/^-- クエリ1/,/^from checked;/p' supabase/sql/016_clothing_image_path_owner_check.sql \
  | docker exec -i -w / "$CONTAINER" psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  | grep '|' | tail -1)
FN=$(psql_run -At -c "select count(*) || '|' || count(*) filter (where not public.is_clothing_image_path_owned_by(img.image_path, ci.user_id)) || '|' || count(*) filter (where not public.is_clothing_image_path_owned_by(img.image_path, ci.user_id) and ci.is_public) from public.clothing_images img join public.clothing_items ci on ci.id = img.clothing_item_id")
echo "query1=$Q1 function=$FN"
[ -n "$Q1" ] && [ "$Q1" = "$FN" ] && echo "ok: query 1 and the function agree" \
  || { echo "FAIL: query 1 and the function disagree"; exit 1; }
