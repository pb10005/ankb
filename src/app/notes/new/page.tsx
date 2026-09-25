// @covers AC-018, AC-023
import { listMyWorkspaces } from "@/core/notes";
import { requireUser } from "@/lib/session";
import { createNoteAction } from "../actions";
import { NoteForm } from "../note-form";

export default async function NewNotePage() {
  const { supabase } = await requireUser("/notes/new");
  const workspaces = await listMyWorkspaces(supabase);
  return (
    <main>
      <h1>新規ノート</h1>
      {workspaces.length === 0 ? (
        <p>所属しているワークスペースがありません。</p>
      ) : (
        <NoteForm action={createNoteAction} workspaces={workspaces} submitLabel="保存" />
      )}
    </main>
  );
}
