// @covers AC-101
// @assumption AS-042
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".git", ".next", "test-results", "playwright-report", "supabase/.temp"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|sql|json|toml|ya?ml|sh|env|example)$|^\.env/;
// テスト自身が一致しないよう、キー名は分割して組み立てる
const KEY = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (SKIP.has(name) || SKIP.has(rel)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(rel);
  }
  return out;
}

describe("サービスロールキーの参照範囲（§5.2-2 / §5.3）", () => {
  it("AC-101: SUPABASE_SERVICE_ROLE_KEY を参照するファイルは src/jobs/ 配下以外に0件", () => {
    const files = walk(ROOT).filter((f) => CODE.test(f.split("/").pop()!) && !f.startsWith("specs/") && !f.startsWith("docs/"));
    // この走査テスト自身は AC-ID をタイトルに含めるためキー名を含む（参照ではない）
    const hits = files.filter((f) => f !== "tests/repo-scan.test.ts" && readFileSync(join(ROOT, f), "utf8").includes(KEY));
    expect(hits.filter((f) => !f.startsWith("src/jobs/"))).toEqual([]);
  });
});
