// @covers AC-079, AC-081, AC-125
// request_relation_approval の承認ダイアログで、人間が実際にクリックしたときだけ呼ぶこと。
// isTrusted の検証はブラウザ側（ダイアログのクリックハンドラ）で行う（AC-080 / AS-029）。
// 承認・却下そのものは Web UI のバナー（proposal-banner.tsx）と同じ resolveProposal() を通す。
import { NextResponse } from "next/server";
import { resolveProposal } from "@/core/relations";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const decision = (body as Record<string, unknown>)?.decision;
  if (decision !== "confirm" && decision !== "reject") {
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "decision が不正です" }, { status: 400 });
  }
  const res = await resolveProposal(supabase, id, decision);
  if (!res.ok) return NextResponse.json({ code: "CONFLICT", message: res.message ?? "処理に失敗しました" }, { status: 409 });
  return NextResponse.json({ id, decision });
}
