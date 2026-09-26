// @covers AC-060, AC-065, AC-071
// @assumption AS-024
// サーバMCP のエンドポイント（Streamable HTTP、ステートレス、JSON レスポンス）。
// OAuth のアクセストークン（ユーザー本人）で Supabase クライアントを作り、RLS の下でツールを実行する（§5.2-2）
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { createAnkbMcpServer } from "@/mcp/server";
import { bindClientUser } from "@/core/notes";
import { unauthorized, verifyMcpToken } from "@/mcp/auth";
import { supabaseEnv } from "@/lib/supabase/env";
import { testSynthesizer } from "@/core/test-synthesizers";

async function handle(request: Request): Promise<Response> {
  const auth = await verifyMcpToken(request.headers.get("authorization"));
  if (!auth) return unauthorized(request);
  const { url, anonKey } = supabaseEnv();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${auth.token}` } },
  });
  bindClientUser(client, auth.userId);
  const synthesizer = testSynthesizer(request.headers.get("x-ankb-test-synth") ?? undefined);
  const server = createAnkbMcpServer(client, synthesizer ? { synthesizer } : {});
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
