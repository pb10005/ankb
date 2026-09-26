// @covers AC-065, AC-071
// @assumption AS-024
// Protected Resource Metadata（RFC 9728）。MCP クライアントはここから認可サーバ（Supabase Auth）を知る
import { supabaseEnv } from "@/lib/supabase/env";
import { publicOrigin } from "@/mcp/auth";

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const { url } = supabaseEnv();
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [`${url}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "ankb",
  });
}
