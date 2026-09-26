// @covers AC-053, AC-056, AC-058
import Link from "next/link";
import { pendingProposals } from "@/core/relations";
import { requireUser } from "@/lib/session";
import { resolveManyAction } from "../relations/actions";

const TYPE_LABEL = { supersedes: "置き換え", contradicts: "食い違い", related: "関連" } as const;

export default async function InboxPage() {
  const { supabase } = await requireUser("/inbox");
  const pending = await pendingProposals(supabase);
  return (
    <main>
      <h1>提案の一覧</h1>
      {pending.length === 0 ? (
        <p>未処理の提案はありません。</p>
      ) : (
        <form action={resolveManyAction} aria-label="提案の一括処理" className="stack">
          <ul className="inbox" aria-label="未処理の提案">
            {pending.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" name="relation_id" value={p.id} defaultChecked />
                  <span className="badge">{TYPE_LABEL[p.type]}</span>「{p.from_title}」→「{p.to_title}」
                </label>
                {p.rationale && <p className="proposal-rationale">理由: {p.rationale}</p>}
                <Link href={`/compare?a=${p.from_note_id}&b=${p.to_note_id}`}>比較する</Link>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="submit" name="decision" value="confirm">
              選択した提案を承認（はい）
            </button>
            <button type="submit" name="decision" value="reject" className="secondary">
              選択した提案を却下（いいえ）
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
