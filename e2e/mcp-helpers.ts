// @covers AC-060, AC-065, AC-123
// サーバMCP を HTTP で呼ぶテスト用クライアント
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFileSync } from "node:child_process";
import { SignJWT, importJWK, type JWK } from "jose";
import { oauthAccessToken } from "../tests/helpers/oauth";
import { PASSWORD, type UserName } from "./helpers";

export const BASE = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

const tokens = new Map<string, string>();
export async function tokenFor(user: UserName): Promise<string> {
  if (!tokens.has(user)) tokens.set(user, (await oauthAccessToken(`${user}@example.com`, PASSWORD)).access_token);
  return tokens.get(user)!;
}

export async function mcpClient(user: UserName, extraHeaders: Record<string, string> = {}): Promise<Client> {
  const token = await tokenFor(user);
  const client = new Client({ name: "ankb-e2e", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } } }));
  return client;
}

export type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text?: string }[] };
export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}
export const errorCode = (r: ToolResult) => (r.isError ? (JSON.parse(r.content[0].text ?? "{}").code as string) : null);

/** ローカル Supabase の署名鍵で、期限切れのトークンを作る（テスト専用。鍵は Auth コンテナの環境変数） */
export async function expiredToken(claims: Record<string, unknown>): Promise<string> {
  const env = execFileSync("docker", ["inspect", "supabase_auth_ankb", "--format", "{{range .Config.Env}}{{println .}}{{end}}"]).toString();
  const keys = JSON.parse(env.split("\n").find((l) => l.startsWith("GOTRUE_JWT_KEYS="))!.slice("GOTRUE_JWT_KEYS=".length)) as (JWK & { kid: string })[];
  const k = keys.find((x) => x.kty === "EC")!;
  const { key_ops: _ops, use: _use, ...jwk } = k;
  void _ops;
  void _use;
  const key = await importJWK(jwk, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims, iat: now - 7200, exp: now - 3600 }).setProtectedHeader({ alg: "ES256", kid: k.kid, typ: "JWT" }).sign(key);
}
