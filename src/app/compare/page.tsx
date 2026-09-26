// @covers AC-057
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNote } from "@/core/notes";
import { diffLines } from "@/core/diff";
import { requireUser } from "@/lib/session";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  const { supabase } = await requireUser(`/compare?a=${a ?? ""}&b=${b ?? ""}`);
  const [na, nb] = await Promise.all([getNote(supabase, a ?? ""), getNote(supabase, b ?? "")]);
  // どちらかを閲覧できなければ存在しないものとして扱う（AS-051）
  if (!na?.ok || !nb?.ok) notFound();
  const { left, right } = diffLines(na.value.body, nb.value.body);
  const column = (title: string, id: string, lines: typeof left, label: string) => (
    <section aria-label={label} className="compare-column">
      <h2>
        <Link href={`/notes/${id}`}>{title}</Link>
      </h2>
      <pre>
        {lines.map((l, i) => (
          <div key={i} className={l.changed ? "diff-changed" : undefined} data-changed={l.changed ? "true" : undefined}>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </section>
  );
  return (
    <main className="wide">
      <h1>ノートの比較</h1>
      <div className="compare" data-testid="compare-view">
        {column(na.value.title, na.value.id, left, "左のノート")}
        {column(nb.value.title, nb.value.id, right, "右のノート")}
      </div>
    </main>
  );
}
