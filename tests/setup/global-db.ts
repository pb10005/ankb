// @covers AC-016
// DB 結合テストの前に fixtures を投入し直す（テスト実行ごとに同じ初期状態）
import { seed } from "../../src/seed/seed";
import { loadTestEnv } from "../helpers/env";

export default async function setup(): Promise<void> {
  const { databaseUrl } = loadTestEnv();
  await seed(databaseUrl);
}
