// @covers AC-119
// ask の回数上限（ユーザーあたり1時間、AS-054）。判定と記録は DB 関数で1回に行う（並行リクエストで超えない）
import type { SupabaseClient } from "@supabase/supabase-js";

export const ASK_LIMIT_PER_HOUR = () => {
  const n = Number(process.env.ANKB_ASK_RATE_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 20;
};

/** 上限内なら使用を記録して true、超えていれば false */
export async function consumeAskQuota(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("consume_ask_quota", { p_limit: ASK_LIMIT_PER_HOUR() });
  return !error && data === true;
}
