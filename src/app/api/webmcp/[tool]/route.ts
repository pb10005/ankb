// @covers AC-072, AC-127
// @assumption AS-027, AS-028
// WebMCP の統一エンドポイント。document.modelContext から登録した各ツールの execute() はここを呼ぶ。
// サーバMCP（src/mcp/server.ts）と同じ toolHandlers() を通すため、検証・レート制限・権限判定は完全に一致する。
import { NextResponse } from "next/server";
import { callWebMcpTool, isWebMcpToolName } from "@/core/webmcp-dispatch";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHENTICATED", message: "ログインが必要です" }, { status: 401 });

  if (!isWebMcpToolName(tool)) return NextResponse.json({ code: "NOT_FOUND", message: "不明なツールです" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const args = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return callWebMcpTool(supabase, tool, args);
}
