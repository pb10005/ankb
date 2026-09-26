// @covers AC-125
// request_relation_approval の事前確認用。両ノートを編集できるか（= 承認・却下できるか）を、
// ダイアログを表示する前に判定する（AC-125: 権限が無ければダイアログ自体を出さない）。
// この確認自体は「ツール」ではない（WebMCP の統一エンドポイントの対象外）ので、専用のルートに置く。
import { NextResponse } from "next/server";
import { canEdit } from "@/core/notes";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 });

  const { data: relation } = await supabase
    .from("note_relation")
    .select("id, from_note_id, to_note_id, type, state, rationale, confidence")
    .eq("id", id)
    .maybeSingle();
  // 閲覧できない・存在しない提案は同じ応答にする（RLS が両端を閲覧できるものだけ返す）
  if (!relation) return NextResponse.json({ code: "NOT_FOUND", message: "見つかりませんでした" }, { status: 404 });

  const canResolve = (await canEdit(supabase, relation.from_note_id)) && (await canEdit(supabase, relation.to_note_id));
  return NextResponse.json({ relation, canResolve });
}
