// @covers AC-069, AC-077, AC-127
// @assumption AS-028
// @assumption AS-072
// WebMCP の読み取り系ツールと propose_relation の実行口。ブラウザのログインセッションで、サーバMCP と同じツール実装（toolHandlers）を呼ぶ
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { toolHandlers } from "@/mcp/server";
import { testSynthesizer } from "@/core/test-synthesizers";

const ALLOWED = new Set(["ask", "get_note", "get_note_lineage", "list_pending_relations", "propose_relation"]);

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!ALLOWED.has(tool)) return NextResponse.json({ code: "NOT_FOUND", message: "ツールが見つかりません" }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 });
  let args: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) args = body;
  } catch {
    // 引数なし
  }
  const synthesizer = testSynthesizer((await cookies()).get("ankb-test-synth")?.value);
  const handlers = toolHandlers(supabase, synthesizer ? { synthesizer } : {});
  const result = await handlers[tool as keyof typeof handlers](args);
  if (result.isError) return NextResponse.json(JSON.parse((result.content[0] as { text: string }).text), { status: 200 });
  return NextResponse.json({ ok: true, value: result.structuredContent });
}
