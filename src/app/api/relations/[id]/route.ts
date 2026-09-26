// @covers AC-079, AC-081, AC-125
// @assumption AS-029
// 承認ダイアログ用: 提案の表示内容と承認可否（GET）、人間のクリックによる承認・却下（POST）
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canEdit } from "@/core/notes";
import { bannerMessage, resolveProposal, type Proposal } from "@/core/relations";

const UUID = /^[0-9a-f-]{36}$/i;

async function load(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 }) };
  // 閲覧できない提案は RLS で見えず、存在しない提案と同じ NOT_FOUND になる
  const { data } = UUID.test(id)
    ? await supabase.from("note_relation").select("id, from_note_id, to_note_id, type, rationale, confidence, created_at, state").eq("id", id).maybeSingle()
    : { data: null };
  if (!data || data.state !== "proposed") return { supabase, error: NextResponse.json({ code: "NOT_FOUND", message: "提案が見つかりません" }) };
  return { supabase, relation: data as Proposal & { state: string } };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, relation, error } = await load(id);
  if (error) return error;
  const { data: titles } = await supabase.from("notes_visible").select("id, title").in("id", [relation!.from_note_id, relation!.to_note_id]);
  const t = new Map(((titles ?? []) as { id: string; title: string }[]).map((n) => [n.id, n.title]));
  const canResolve = (await canEdit(supabase, relation!.from_note_id)) && (await canEdit(supabase, relation!.to_note_id));
  return NextResponse.json({
    id: relation!.id,
    message: bannerMessage(relation!, relation!.from_note_id, t.get(relation!.to_note_id) ?? ""),
    from_title: t.get(relation!.from_note_id),
    to_title: t.get(relation!.to_note_id),
    rationale: relation!.rationale,
    canResolve,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, error } = await load(id);
  if (error) return error;
  const { decision } = (await request.json().catch(() => ({}))) as { decision?: string };
  if (decision !== "confirm" && decision !== "reject") return NextResponse.json({ code: "VALIDATION_ERROR", message: "decision は confirm か reject" }, { status: 400 });
  const res = await resolveProposal(supabase, id, decision);
  return res.ok ? NextResponse.json({ state: decision === "confirm" ? "confirmed" : "rejected" }) : NextResponse.json({ code: "FORBIDDEN", message: res.message }, { status: 403 });
}
