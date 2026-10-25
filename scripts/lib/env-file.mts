// .env.local の1行だけを書き換える helper。値は画面に出さない。
// 対応していない形（同じ名前が複数ある、引用符つきの複数行の値がある）は、
// 他の値を壊さないよう、何も書かずに例外にする。メッセージには変数名だけを入れる。
import { readFile, writeFile } from "node:fs/promises";
import { StageFailure } from "./stage-error.mts";

// 引用符で始まり、同じ行で閉じていない値か
function opensMultilineQuote(line: string): string | null {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'`])(.*)$/.exec(line);
  if (!match) return null;
  return match[3].includes(match[2]) ? null : match[1];
}

export async function upsertEnvFile(
  path: string,
  name: string,
  value: string,
): Promise<"added" | "updated" | "unchanged"> {
  if (/[\r\n]/.test(value)) {
    throw new StageFailure(`${name} の値に改行が入っているため、書き込めません`);
  }

  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // ファイルがまだないときは新しく作る
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const newLine = `${name}=${value}`;
  const lines = text.split("\n");

  for (const line of lines) {
    const multiline = opensMultilineQuote(line);
    if (multiline) {
      throw new StageFailure(`${multiline} が複数行の値のため、${name} を安全に書き換えられません。手で直してください`);
    }
  }
  const matches = lines.flatMap((line, i) => (line.startsWith(`${name}=`) ? [i] : []));
  if (matches.length > 1) {
    throw new StageFailure(`${name} が .env.local に複数あるため、書き換えられません。1つにしてください`);
  }

  if (matches.length === 1) {
    const index = matches[0];
    if (lines[index] === newLine) return "unchanged";
    lines[index] = newLine;
    await writeFile(path, lines.join("\n"), { mode: 0o600 });
    return "updated";
  }

  // 末尾に改行がなければ足してから追記する
  const prefix = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  await writeFile(path, `${prefix}${newLine}\n`, { mode: 0o600 });
  return "added";
}
