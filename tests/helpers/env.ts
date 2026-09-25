// @covers AC-016
// @assumption AS-002
// テストから .env.local（supabase start の出力値）を読む
import { existsSync } from "node:fs";

export function loadTestEnv(): { url: string; anonKey: string; databaseUrl: string } {
  if (existsSync(".env.local") && !process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error(".env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が必要（supabase start の出力）");
  return { url, anonKey, databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" };
}
