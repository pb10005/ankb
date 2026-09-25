// @covers AC-019, AC-024
import Link from "next/link";
import { listNotes } from "@/core/notes";
import { STATUS_LABEL, VISIBILITY_LABEL } from "@/core/labels";
import { requireUser } from "@/lib/session";

export default async function NotesPage() {
  const { supabase } = await requireUser("/notes");
  const notes = await listNotes(supabase);
  return (
    <main>
      <header className="bar">
        <h1>ノート</h1>
        <Link href="/notes/new" className="button">
          新規ノート
        </Link>
      </header>
      {notes.length === 0 ? (
        <p>ノートはまだありません。</p>
      ) : (
        <ul className="note-list" aria-label="ノート一覧">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`}>{n.title}</Link>
              <span className="badges">
                <span className="badge">{STATUS_LABEL[n.status]}</span>
                <span className="badge">{VISIBILITY_LABEL[n.visibility]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/dashboard">ダッシュボードへ戻る</Link>
      </p>
    </main>
  );
}
