// .env.local 書き換え用の helper（scripts/lib/env-file.mts）の自動テスト。
// 一時ディレクトリのファイルだけを使う。
//
// 実行方法:
//   node --test scripts/test-media-env-file.mts

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { upsertEnvFile } = await import("./lib/env-file.mts");

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "env-file-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("名前がないファイル：末尾に足し、ほかの行はそのまま", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    await writeFile(path, "# comment\nA=1\n\nB=2\n");
    assert.equal(await upsertEnvFile(path, "C", "3"), "added");
    assert.equal(await readFile(path, "utf8"), "# comment\nA=1\n\nB=2\nC=3\n");
  });
});

test("末尾に改行がないファイルにも足せる", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    await writeFile(path, "A=1");
    assert.equal(await upsertEnvFile(path, "B", "2"), "added");
    assert.equal(await readFile(path, "utf8"), "A=1\nB=2\n");
  });
});

test("すでにある行：その行だけ置き換え、ほかの行は同じ", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    await writeFile(path, "# c\nA=1\nNAME=old\n\nNAME_X=keep\nB=2\n");
    assert.equal(await upsertEnvFile(path, "NAME", "new"), "updated");
    assert.equal(await readFile(path, "utf8"), "# c\nA=1\nNAME=new\n\nNAME_X=keep\nB=2\n");
  });
});

test("同じ値：unchanged で、ファイルは変わらない", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    await writeFile(path, "A=1\nNAME=same\n");
    assert.equal(await upsertEnvFile(path, "NAME", "same"), "unchanged");
    assert.equal(await readFile(path, "utf8"), "A=1\nNAME=same\n");
  });
});

test("ファイルがまだない：作って added", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    assert.equal(await upsertEnvFile(path, "NAME", "v"), "added");
    assert.equal(await readFile(path, "utf8"), "NAME=v\n");
  });
});

// 対応していない形は、何も書かずに例外にする（メッセージには変数名だけ。値は入れない）
async function assertRefused(content: string, name: string, value: string, secretInFile?: string) {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    await writeFile(path, content);
    await assert.rejects(upsertEnvFile(path, name, value), (error: Error) => {
      assert.ok(error.message.includes(name));
      if (secretInFile) assert.ok(!error.message.includes(secretInFile));
      assert.ok(!error.message.includes(value));
      return true;
    });
    assert.equal(await readFile(path, "utf8"), content);
  });
}

test("同じ名前が2回ある：書かずに例外（ファイルは変わらない）", async () => {
  await assertRefused("NAME=old1\nA=1\nNAME=old2\n", "NAME", "VALUE-X");
});

test("引用符つきで複数行の値がある：書かずに例外（ファイルは変わらない）", async () => {
  await assertRefused('KEY="line1\nNAME=inside\nline3"\nNAME=old\n', "NAME", "VALUE-X", "inside");
});

test("書く値に改行がある：書かずに例外（ファイルは変わらない）", async () => {
  await assertRefused("A=1\n", "NAME", "a\nb");
});

test("1行で閉じた引用符つきの値は、そのまま通る", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".env");
    await writeFile(path, 'Q="one line"\nNAME=old\n');
    assert.equal(await upsertEnvFile(path, "NAME", "new"), "updated");
    assert.equal(await readFile(path, "utf8"), 'Q="one line"\nNAME=new\n');
  });
});
