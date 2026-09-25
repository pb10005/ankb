"use client";
// @covers AC-018, AC-023, AC-132
import { useActionState } from "react";
import type { FormState } from "./actions";

type Props = {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  workspaces?: { id: string; name: string }[];
  note?: { id: string; title: string; body: string; version: number };
  submitLabel: string;
};

export function NoteForm({ action, workspaces, note, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null });
  return (
    <form action={formAction} className="stack" aria-label="ノートの編集">
      {note && <input type="hidden" name="id" value={note.id} />}
      {note && <input type="hidden" name="version" value={note.version} />}
      {workspaces && workspaces.length === 1 && <input type="hidden" name="workspace_id" value={workspaces[0].id} />}
      {workspaces && workspaces.length > 1 && (
        <label>
          ワークスペース
          <select name="workspace_id" defaultValue={workspaces[0].id}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        タイトル
        <input name="title" defaultValue={note?.title} />
      </label>
      <label>
        本文（Markdown）
        <textarea name="body" rows={16} defaultValue={note?.body} />
      </label>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
