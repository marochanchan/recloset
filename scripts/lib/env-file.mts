// .env.local の1行だけを書き換える helper。値は画面に出さない。
import { readFile, writeFile } from "node:fs/promises";

export async function upsertEnvFile(
  path: string,
  name: string,
  value: string,
): Promise<"added" | "updated" | "unchanged"> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // ファイルがまだないときは新しく作る
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const newLine = `${name}=${value}`;
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));

  if (index >= 0) {
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
