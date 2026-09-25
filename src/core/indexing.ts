// @covers AC-027, AC-033, AC-090
// @assumption AS-012
// @assumption AS-040
// ノートの保存時にチャンクと embedding を作り直す（編集者の権限で書く: AS-041）。
// embedding の生成に失敗してもチャンクは embedding=null で保存し、全文検索の対象にする（AS-040）。
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkNote } from "./chunking";
import { defaultEmbedder, toPgVector, type Embedder } from "./embedding";

export async function buildChunkRows(noteId: string, title: string, body: string, embedder: Embedder = defaultEmbedder()) {
  const chunks = chunkNote(title, body);
  let vectors: (number[] | null)[] = chunks.map(() => null);
  try {
    vectors = await embedder.embed(chunks, "document");
  } catch {
    // AS-040: バックグラウンドで補完する
  }
  return chunks.map((content, i) => ({
    note_id: noteId,
    chunk_index: i,
    content,
    embedding: vectors[i] ? toPgVector(vectors[i]!) : null,
  }));
}

export async function reindexNote(client: SupabaseClient, note: { id: string; title: string; body: string }, embedder?: Embedder): Promise<void> {
  const rows = await buildChunkRows(note.id, note.title, note.body, embedder);
  const del = await client.from("note_chunk").delete().eq("note_id", note.id);
  if (del.error) throw new Error(`チャンクの削除に失敗: ${del.error.message}`);
  const ins = await client.from("note_chunk").insert(rows);
  if (ins.error) throw new Error(`チャンクの保存に失敗: ${ins.error.message}`);
}
