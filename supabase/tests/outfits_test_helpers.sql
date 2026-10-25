-- =========================================
-- コーデ機能（020〜）のDBテスト共通の補助関数
-- （ローカルのDockerのPostgres専用。run-outfits.sh がテストの前に読み込む）
-- =========================================
create schema if not exists test;
grant usage on schema test to anon, authenticated;

create or replace function test.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'ok: %', msg;
end;
$$;

-- 権限エラー（insufficient_privilege）になることを確かめる
create or replace function test.expect_denied(stmt text, msg text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    raise notice 'ok (denied): %', msg;
    return;
  end;
  raise exception 'FAIL (not denied): %', msg;
end;
$$;

-- 例外になり、メッセージに expected_message を含むことを確かめる
-- （外部キー・check の失敗は制約名や 'violates foreign key constraint' で確かめる）
create or replace function test.expect_error(stmt text, expected_message text, msg text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if position(expected_message in sqlerrm) > 0 then
      raise notice 'ok (error): %', msg;
      return;
    end if;
    raise exception 'FAIL (unexpected error: %): %', sqlerrm, msg;
  end;
  raise exception 'FAIL (no error): %', msg;
end;
$$;

grant execute on all functions in schema test to anon, authenticated;
