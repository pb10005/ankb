// @covers AC-034
// 実際の embedding（Voyage AI）を使う評価テスト。VOYAGE_API_KEY が必要（npm run test:eval）。
import { afterAll, describe, expect, it } from "vitest";
import { closeAdmin, createNote } from "../helpers/db";
import { searchAs } from "../helpers/search";
import { buildChunkRows } from "../../src/core/indexing";
import { VoyageEmbedder } from "../../src/core/embedding";
import { NoopQueryExpander } from "../../src/core/query-expansion";
import { admin } from "../helpers/db";

afterAll(closeAdmin);

describe("意味検索の評価（実 embedding）", () => {
  it("AC-034: 『ホテル代っていくらまで？』で『1泊あたりの宿泊費の上限は12,000円』のノートが hits の上位5件以内", async () => {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) throw new Error("VOYAGE_API_KEY が未設定のため評価できない（実 embedding が必要）");
    const embedder = new VoyageEmbedder(key);
    const id = await createNote({ owner: "misaki", visibility: "workspace", title: "宿泊費について", body: "1泊あたりの宿泊費の上限は12,000円" });
    try {
      for (const c of await buildChunkRows(id, "宿泊費について", "1泊あたりの宿泊費の上限は12,000円", embedder)) {
        await admin().query("delete from public.note_chunk where note_id = $1 and chunk_index = $2", [id, c.chunk_index]);
        await admin().query("insert into public.note_chunk (note_id, chunk_index, content, embedding) values ($1, $2, $3, $4)", [id, c.chunk_index, c.content, c.embedding]);
      }
      const r = await searchAs("misaki", "ホテル代っていくらまで？", { embedder, expander: new NoopQueryExpander() });
      expect(r.hits.slice(0, 5).map((h) => h.note_id)).toContain(id);
    } finally {
      await admin().query("delete from public.notes where id = $1", [id]);
    }
  });
});
