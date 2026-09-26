// @covers AC-072, AC-073, AC-127
// @assumption AS-027, AS-028
// WebMCP のツール呼び出しをサーバMCPと同じ toolHandlers() に委譲する（指示書 §1.3 入口の一貫性）。
// WebMCP に公開するのは読み取り系5件 + propose_relation の計6件（AS-027）。create_note / update_note は
// 公開しない（確定操作は人間のクリックを経由する。draft_note は保存しない画面操作であって create_note ではない）。
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toolHandlers } from "@/mcp/server";

export const WEBMCP_TOOL_NAMES = ["search_knowledge", "ask", "get_note", "get_note_lineage", "list_pending_relations", "propose_relation"] as const;
export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export function isWebMcpToolName(name: string): name is WebMcpToolName {
  return (WEBMCP_TOOL_NAMES as readonly string[]).includes(name);
}

const STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
};

export async function callWebMcpTool(client: SupabaseClient, name: WebMcpToolName, args: Record<string, unknown>): Promise<NextResponse> {
  const handlers = toolHandlers(client);
  const result = await handlers[name](args);
  const first = result.content[0];
  const parsed = first && first.type === "text" ? (JSON.parse(first.text) as Record<string, unknown>) : {};
  if (result.isError) {
    const status = STATUS[String(parsed.code)] ?? 400;
    return NextResponse.json(parsed, { status });
  }
  return NextResponse.json(parsed);
}
