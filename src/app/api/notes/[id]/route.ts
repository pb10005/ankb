// @covers AC-021, AC-075, AC-130
// @assumption AS-062
import { NextResponse } from "next/server";
import { getNote, updateNote } from "@/core/notes";
import { HTTP_STATUS } from "@/core/result";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 });

  const res = await getNote(supabase, id);
  // 閲覧できないノートは存在しないノートと同じ応答にする（AS-051 / AC-127）
  if (!res || !res.ok) return NextResponse.json({ code: "NOT_FOUND", message: "見つかりませんでした" }, { status: 404 });
  return NextResponse.json(res.value);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "JSON を送ってください" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "JSON オブジェクトを送ってください" }, { status: 400 });
  }
  const res = await updateNote(supabase, id, body as Record<string, unknown>);
  if (!res.ok) return NextResponse.json({ code: res.code, message: res.message }, { status: HTTP_STATUS[res.code] });
  return NextResponse.json(res.value);
}
