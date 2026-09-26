// @covers AC-016
// @assumption AS-016
// DB 結合テストの前に fixtures を投入し直す（テスト実行ごとに同じ初期状態）
import type { TestProject } from "vitest/node";
import { seed } from "../../src/seed/seed";
import { StubEmbedder } from "../../src/core/embedding";
import { loadTestEnv } from "../helpers/env";

export default async function setup(project: TestProject): Promise<void> {
  const { databaseUrl } = loadTestEnv();
  // db プロジェクトはスタブ embedding で検索するので、.env.local に VOYAGE_API_KEY があっても fixtures はスタブで作る（AS-016）
  await seed(databaseUrl, project.name === "db" ? new StubEmbedder() : undefined);
}
