// @covers AC-069
// @assumption AS-028
// Web UI（と WebMCP）の検索API。ログインセッションで searchKnowledge を呼ぶ（サーバMCP と同じ関数: §1.3）
import { NextResponse } from "next/server";
import { searchKnowledge } from "@/core/search";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 });
  if (q.trim() === "" || q.length > 500) return NextResponse.json({ code: "VALIDATION_ERROR", message: "q を 1〜500 文字で指定してください" }, { status: 400 });
  return NextResponse.json(await searchKnowledge(supabase, q));
}
