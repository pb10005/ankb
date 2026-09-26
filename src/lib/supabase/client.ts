// @covers AC-072
// ブラウザ（クライアントコンポーネント）用の Supabase クライアント。WebMCP はこれで Web UI と同じセッションを使う（AS-028）。
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
