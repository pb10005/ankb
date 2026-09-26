// @covers AC-053, AC-056, AC-058
import Link from "next/link";
import { pendingProposals } from "@/core/relations";
import { createClient } from "@/lib/supabase/server";

/** ヘッダーの未処理の提案件数。未ログインでは何も出さない */
export async function PendingBadge() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const pending = await pendingProposals(supabase);
  return (
    <Link href="/inbox" className="pending-badge" aria-label={`未処理の提案 ${pending.length}件`}>
      提案 <span data-testid="pending-count">{pending.length}</span>
    </Link>
  );
}
