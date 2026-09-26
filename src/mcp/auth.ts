// @covers AC-065, AC-120
// @assumption AS-024
// MCP のアクセストークン検証。Supabase Auth（OAuth 2.1 サーバ）が発行した JWT を JWKS で検証し、
// OAuth クライアント向けに発行されたもの（client_id クレームあり）だけを受け付ける。
// Web UI のログインで得たセッション JWT（client_id なし）は拒否する（AC-065 (d)）。
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { supabaseEnv } from "@/lib/supabase/env";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export type McpAuth = { token: string; userId: string; clientId: string; claims: JWTPayload };

export async function verifyMcpToken(authorization: string | null): Promise<McpAuth | null> {
  const m = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const { url } = supabaseEnv();
  jwks ??= createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(m[1], jwks, { issuer: `${url}/auth/v1`, requiredClaims: ["exp", "sub", "client_id"] });
    const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
    if (!payload.sub || !clientId || payload.role !== "authenticated") return null;
    return { token: m[1], userId: payload.sub, clientId, claims: payload };
  } catch {
    return null; // 期限切れ・署名不正・発行者違い
  }
}

/**
 * ankb の公開オリジン。本番は環境変数 ANKB_PUBLIC_ORIGIN で固定する（ヘッダで差し替えられないように）。
 * 未設定（開発）では Host ヘッダを使う（request.url は開発サーバで localhost に正規化される）
 */
export function publicOrigin(request: Request): string {
  const fixed = process.env.ANKB_PUBLIC_ORIGIN;
  if (fixed) return fixed.replace(/\/$/, "");
  const u = new URL(request.url);
  return `${u.protocol}//${request.headers.get("host") ?? u.host}`;
}

/** Protected Resource Metadata（RFC 9728）の URL。WWW-Authenticate で案内する */
export function resourceMetadataUrl(request: Request): string {
  return `${publicOrigin(request)}/.well-known/oauth-protected-resource/mcp`;
}

export function unauthorized(request: Request): Response {
  return new Response(JSON.stringify({ code: "UNAUTHENTICATED", message: "OAuth のアクセストークンが必要です" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl(request)}"`,
    },
  });
}
