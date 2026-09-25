// @covers AC-002, AC-004
// サーバコンポーネント・Server Action 用の Supabase クライアント。
// ユーザー本人のセッション（cookie）で DB にアクセスする。サービスロールキーは使わない（指示書 §5.2-2）。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // サーバコンポーネントからは cookie を書けない。セッションの更新は proxy が担う。
        }
      },
    },
  });
}
