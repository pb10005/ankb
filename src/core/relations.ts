// @covers AC-049, AC-050, AC-051, AC-052, AC-053, AC-056, AC-058, AC-112, AC-116
// 置き換え・矛盾・関連の提案の表示と承認（指示書 §6.2 承認）。
// 見える提案は RLS（両端のノートを閲覧できるもの）で決まり、承認・却下は resolve_relation（両方の編集権限が必要）を通す。
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEdit } from "./notes";

export type Proposal = {
  id: string;
  from_note_id: string;
  to_note_id: string;
  type: "supersedes" | "contradicts" | "related";
  rationale: string;
  confidence: number | null;
  created_at: string;
};

export type ProposalView = Proposal & {
  /** ノート画面から見た相手ノート */
  other: { id: string; title: string };
  /** バナーの文言 */
  message: string;
  /** 両方のノートを編集できる（承認・却下できる）か */
  canResolve: boolean;
};

const COLS = "id, from_note_id, to_note_id, type, rationale, confidence, created_at";

async function titles(client: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await client.from("notes_visible").select("id, title").in("id", ids);
  return new Map(((data ?? []) as { id: string; title: string }[]).map((n) => [n.id, n.title]));
}

export function bannerMessage(p: Proposal, viewingNoteId: string, otherTitle: string): string {
  if (p.type === "contradicts") return `このノートは「${otherTitle}」と内容が食い違っています`;
  if (p.type === "related") return `このノートは「${otherTitle}」と関連していますか？`;
  return p.from_note_id === viewingNoteId
    ? `このノートは「${otherTitle}」を置き換えるものですか？`
    : `このノートは「${otherTitle}」に置き換えられていますか？`;
}

/** ノート画面のバナー用。閲覧できない相手との提案は RLS により現れない（AC-112） */
export async function proposalsForNote(client: SupabaseClient, noteId: string): Promise<ProposalView[]> {
  const { data } = await client
    .from("note_relation")
    .select(COLS)
    .eq("state", "proposed")
    .or(`from_note_id.eq.${noteId},to_note_id.eq.${noteId}`)
    .order("created_at", { ascending: false });
  const proposals = (data ?? []) as Proposal[];
  const others = proposals.map((p) => (p.from_note_id === noteId ? p.to_note_id : p.from_note_id));
  const t = await titles(client, others);
  const views: ProposalView[] = [];
  for (const p of proposals) {
    const otherId = p.from_note_id === noteId ? p.to_note_id : p.from_note_id;
    const otherTitle = t.get(otherId);
    if (!otherTitle) continue;
    const canResolve = (await canEdit(client, p.from_note_id)) && (await canEdit(client, p.to_note_id));
    views.push({ ...p, other: { id: otherId, title: otherTitle }, message: bannerMessage(p, noteId, otherTitle), canResolve });
  }
  return views;
}

/** インボックス・ヘッダー件数: 自分が処理できる（両方を編集できる）未承認の提案（AC-053 / AC-056） */
export async function pendingProposals(client: SupabaseClient): Promise<(Proposal & { from_title: string; to_title: string })[]> {
  const { data } = await client.rpc("pending_relations");
  const proposals = (data ?? []) as Proposal[];
  const t = await titles(client, proposals.flatMap((p) => [p.from_note_id, p.to_note_id]));
  return proposals
    .filter((p) => t.has(p.from_note_id) && t.has(p.to_note_id))
    .map((p) => ({ ...p, from_title: t.get(p.from_note_id)!, to_title: t.get(p.to_note_id)! }));
}

export async function resolveProposal(client: SupabaseClient, id: string, decision: "confirm" | "reject"): Promise<{ ok: boolean; message?: string }> {
  const { error } = await client.rpc("resolve_relation", { p_relation_id: id, p_decision: decision });
  return error ? { ok: false, message: error.message } : { ok: true };
}
