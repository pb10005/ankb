// @covers AC-049
// @assumption AS-020
// @assumption AS-076
// 応答を返した後に推定キューを処理する（ノートの保存・公開の直後に提案を出すため）。取りこぼしは pg_cron が回収する
import { after } from "next/server";
import { drainRelationQueue } from "./relation-inference";

export function kickRelationInference(): void {
  after(async () => {
    try {
      await drainRelationQueue();
    } catch (e) {
      console.error("[ankb] relation inference failed:", e);
    }
  });
}
