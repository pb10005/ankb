// @covers AC-060, AC-065, AC-070, AC-120
// @assumption AS-024
// テスト用に Supabase Auth の OAuth 2.1 サーバからアクセストークンを得る:
// 動的クライアント登録 → 認可リクエスト（PKCE）→ ユーザーのセッションで同意 → コードをトークンに交換
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./env";

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "http://127.0.0.1:9/callback";

export async function oauthAccessToken(email: string, password: string): Promise<{ access_token: string; client_id: string }> {
  const { url, anonKey } = loadTestEnv();
  const reg = await fetch(`${url}/auth/v1/oauth/clients/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ankb テストクライアント", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  if (!reg.ok) throw new Error(`client register: ${reg.status} ${await reg.text()}`);
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s" });
  const authz = await fetch(`${url}/auth/v1/oauth/authorize?${q}`, { redirect: "manual" });
  const loc = authz.headers.get("location");
  if (!loc) throw new Error(`authorize: ${authz.status} ${await authz.text()}`);
  const authorizationId = new URL(loc).searchParams.get("authorization_id");
  if (!authorizationId) throw new Error(`authorize location: ${loc}`);

  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  // 同意画面と同じ順序: 詳細を取得してから承認する
  const details = await user.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error) throw details.error;
  const approved = await user.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (approved.error || !approved.data) throw approved.error ?? new Error("approve failed");
  const code = new URL(approved.data.redirect_url).searchParams.get("code");
  if (!code) throw new Error(`no code: ${approved.data.redirect_url}`);

  const tok = await fetch(`${url}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id, code_verifier: verifier }),
  });
  if (!tok.ok) throw new Error(`token: ${tok.status} ${await tok.text()}`);
  const { access_token } = (await tok.json()) as { access_token: string };
  return { access_token, client_id };
}
