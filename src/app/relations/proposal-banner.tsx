"use client";
// @covers AC-049, AC-050, AC-051, AC-052, AC-057, AC-058, AC-116
// @assumption AS-075
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { resolveAction } from "./actions";

type Props = {
  noteId: string;
  proposals: { id: string; message: string; rationale: string; otherId: string; canResolve: boolean }[];
};

const KEY = "ankb-deferred-proposals";
const listeners = new Set<() => void>();

// 『後で』にした提案 id を sessionStorage に持つ小さなストア（サーバ描画では空）
function readDeferred(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function defer(id: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...JSON.parse(readDeferred()), id]));
  } catch {
    // 保存できない環境では隠せない（提案は proposed のまま残る）
  }
  listeners.forEach((l) => l());
}

/** 提案のバナー。『後で』は提案を proposed のまま残し、このブラウザのセッション中だけバナーを隠す */
export function ProposalBanner({ noteId, proposals }: Props) {
  const deferred = JSON.parse(useSyncExternalStore(subscribe, readDeferred, () => "[]")) as string[];
  const visible = proposals.filter((p) => !deferred.includes(p.id));
  if (visible.length === 0) return null;
  return (
    <div className="proposals">
      {visible.map((p) => (
        <section key={p.id} role="region" aria-label="提案" className="proposal-banner">
          <p className="proposal-message">{p.message}</p>
          {p.rationale && <p className="proposal-rationale">理由: {p.rationale}</p>}
          <div className="actions">
            {p.canResolve && (
              <>
                <form action={resolveAction}>
                  <input type="hidden" name="relation_id" value={p.id} />
                  <input type="hidden" name="decision" value="confirm" />
                  <input type="hidden" name="back" value={`/notes/${noteId}`} />
                  <button type="submit">はい</button>
                </form>
                <form action={resolveAction}>
                  <input type="hidden" name="relation_id" value={p.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <input type="hidden" name="back" value={`/notes/${noteId}`} />
                  <button type="submit" className="secondary">
                    いいえ
                  </button>
                </form>
              </>
            )}
            <button type="button" className="secondary" onClick={() => defer(p.id)}>
              後で
            </button>
            <Link href={`/compare?a=${noteId}&b=${p.otherId}`}>比較する</Link>
          </div>
        </section>
      ))}
    </div>
  );
}
