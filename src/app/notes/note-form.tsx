"use client";
// @covers AC-018, AC-023, AC-132, AC-082, AC-134
import { useActionState, useEffect, useState } from "react";
import type { FormState } from "./actions";
import { DRAFT_STORAGE_KEY, webMcpBridge } from "@/lib/webmcp/bridge";

type Props = {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  workspaces?: { id: string; name: string }[];
  note?: { id: string; title: string; body: string; version: number };
  submitLabel: string;
};

function readDraft(): { title: string; body: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    const parsed = JSON.parse(raw) as { title?: string; body?: string };
    return { title: parsed.title ?? "", body: parsed.body ?? "" };
  } catch {
    return null;
  }
}

export function NoteForm({ action, workspaces, note, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null });
  // 新規作成時は WebMCP の draft_note が sessionStorage 経由で渡した下書きを一度だけ拾う（AC-082）
  const [draft] = useState(() => (note ? null : readDraft()));
  const initialTitle = note?.title ?? draft?.title ?? "";
  const initialBody = note?.body ?? draft?.body ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  useEffect(() => {
    const dirty = title !== initialTitle || body !== initialBody;
    webMcpBridge.setUnsavedChanges(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);
  useEffect(() => () => webMcpBridge.setUnsavedChanges(false), []);

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
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        本文（Markdown）
        <textarea name="body" rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
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
