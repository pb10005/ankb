// @covers AC-068, AC-124
// ノート単位の関係情報（get_note / get_note_lineage 用）。閲覧できないノートは返さない（§5.2-3）
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conflict } from "./search";

export type LineageEntry = { note_id: string; title: string; status: string; date: string; superseded_by?: string };

/** 置き換えの連鎖を時系列で返す。閲覧できない中間ノートは除き、その先の閲覧できるノートはつなぐ */
export async function noteLineage(client: SupabaseClient, noteId: string): Promise<LineageEntry[] | null> {
  const { data, error } = await client.rpc("note_lineage", { p_note_id: noteId });
  if (error) return null;
  return (data ?? []) as LineageEntry[];
}

export async function noteRelationsSummary(client: SupabaseClient, noteId: string): Promise<{ possibly_outdated: boolean; conflicts: Conflict[] }> {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) return { possibly_outdated: false, conflicts: [] };
  // note_relation は RLS により両端を閲覧できる関係だけが返る
  const { data } = await client
    .from("note_relation")
    .select("from_note_id, to_note_id, type, state, rationale")
    .in("state", ["proposed", "confirmed"])
    .or(`from_note_id.eq.${noteId},to_note_id.eq.${noteId}`);
  const rows = (data ?? []) as { from_note_id: string; to_note_id: string; type: string; state: "proposed" | "confirmed"; rationale: string }[];
  return {
    possibly_outdated: rows.some((r) => r.type === "supersedes" && r.state === "proposed" && r.to_note_id === noteId),
    conflicts: rows
      .filter((r) => r.type === "contradicts")
      .map((r) => ({ note_ids: [r.from_note_id, r.to_note_id], summary: r.rationale, relation_state: r.state })),
  };
}
