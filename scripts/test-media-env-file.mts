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
