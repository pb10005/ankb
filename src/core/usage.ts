// @covers AC-119
// ask の回数上限（ユーザーあたり1時間）。LLM の利用料の暴走を防ぐ。記録は RLS で本人の行だけ
import type { SupabaseClient } from "@supabase/supabase-js";

export const ASK_LIMIT_PER_HOUR = () => Number(process.env.ANKB_ASK_RATE_LIMIT ?? 20);

/** 上限内なら使用を記録して true、超えていれば false */
export async function consumeAskQuota(client: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await client.from("ask_usage").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= ASK_LIMIT_PER_HOUR()) return false;
  const { error } = await client.from("ask_usage").insert({});
  return !error;
}
