// @covers AC-076, AC-128
// 人間向けの検索画面。検索クエリを画面の文脈として登録する（エージェントの get_current_context）
import Link from "next/link";
import { searchKnowledge } from "@/core/search";
import { requireUser } from "@/lib/session";
import { PageContext } from "@/webmcp/page-context";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const { supabase } = await requireUser(`/search?q=${encodeURIComponent(q)}`);
  const result = q.trim() ? await searchKnowledge(supabase, q) : null;
  return (
    <main>
      <PageContext query={q.trim() || undefined} />
      <h1>検索</h1>
      <form action="/search" className="inline" aria-label="検索フォーム">
        <label>
          検索語
          <input name="q" defaultValue={q} />
        </label>
        <button type="submit">検索</button>
      </form>
      {result && (
        <>
          <ul className="note-list" aria-label="検索結果">
            {result.hits.map((h, i) => (
              <li key={`${h.note_id}-${i}`}>
                <Link href={`/notes/${h.note_id}`}>{h.title}</Link>
                {h.possibly_outdated && <span className="badge">更新されている可能性</span>}
              </li>
            ))}
          </ul>
          {result.superseded_context.length > 0 && (
            <section aria-label="旧情報">
              <h2>古い情報</h2>
              <ul>
                {result.superseded_context.map((h, i) => (
                  <li key={`${h.note_id}-${i}`}>
                    <span className="badge">旧情報</span> <Link href={`/notes/${h.note_id}`}>{h.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
