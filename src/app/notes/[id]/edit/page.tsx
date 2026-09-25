// @covers AC-022, AC-132
import { notFound } from "next/navigation";
import { canEdit, getNote } from "@/core/notes";
import { requireUser } from "@/lib/session";
import { saveNoteAction } from "../../actions";
import { NoteForm } from "../../note-form";

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/notes/${id}/edit`);
  const res = await getNote(supabase, id);
  if (!res?.ok || !(await canEdit(supabase, id))) notFound();
  const { title, body, version } = res.value;
  return (
    <main>
      <h1>ノートを編集</h1>
      <NoteForm action={saveNoteAction} note={{ id, title, body, version }} submitLabel="保存" />
    </main>
  );
}
