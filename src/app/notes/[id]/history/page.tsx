// @covers AC-022
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNote, listVersions } from "@/core/notes";
import { requireUser } from "@/lib/session";

const formatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/notes/${id}/history`);
  const res = await getNote(supabase, id);
  if (!res?.ok) notFound();
  const versions = await listVersions(supabase, id);
  return (
    <main>
      <p>
        <Link href={`/notes/${id}`}>← {res.value.title}</Link>
      </p>
      <h1>版履歴</h1>
      {versions.length === 0 ? (
        <p>過去の版はありません。</p>
      ) : (
        <ol className="versions" aria-label="版履歴">
          {versions.map((v) => (
            <li key={v.version}>
              <h2>
                <time dateTime={v.created_at}>{formatter.format(new Date(v.created_at))}</time> の版（第{v.version}版）
              </h2>
              <p className="version-title">{v.title}</p>
              <pre className="version-body">{v.body}</pre>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
