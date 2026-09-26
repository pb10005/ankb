"use server";
// @covers AC-018, AC-019, AC-020, AC-022, AC-023, AC-024, AC-025, AC-132, AC-138
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createNote, getNote, setShare, updateNote } from "@/core/notes";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error: string | null };

export async function createNoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  const res = await createNote(supabase, {
    workspace_id: String(form.get("workspace_id") ?? ""),
    title: String(form.get("title") ?? ""),
    body: String(form.get("body") ?? ""),
  });
  if (!res.ok) return { error: res.message };
  redirect(`/notes/${res.value.id}`);
}

export async function saveNoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id"));
  const supabase = await createClient();
  const res = await updateNote(supabase, id, {
    title: String(form.get("title") ?? ""),
    body: String(form.get("body") ?? ""),
    expected_version: Number(form.get("version")),
  });
  if (!res.ok) return { error: res.message };
  revalidatePath(`/notes/${id}`);
  redirect(`/notes/${id}`);
}

async function changeField(form: FormData, patch: Record<string, unknown>): Promise<void> {
  const id = String(form.get("id"));
  const supabase = await createClient();
  const res = await updateNote(supabase, id, { ...patch, expected_version: Number(form.get("version")) });
  revalidatePath(`/notes/${id}`);
  // 失敗したらノート画面にエラーを表示する（AC-138）
  redirect(res.ok ? `/notes/${id}` : `/notes/${id}?error=${res.code.toLowerCase()}`);
}

export async function publishNoteAction(form: FormData): Promise<void> {
  await changeField(form, { status: "active" });
}

export async function archiveNoteAction(form: FormData): Promise<void> {
  await changeField(form, { status: "archived" });
}

export async function setVisibilityAction(form: FormData): Promise<void> {
  await changeField(form, { visibility: String(form.get("visibility")) });
}

export async function setShareAction(form: FormData): Promise<void> {
  const id = String(form.get("id"));
  const supabase = await createClient();
  const note = await getNote(supabase, id);
  if (note?.ok) {
    const permission = String(form.get("permission"));
    const res = await setShare(supabase, note.value, String(form.get("user_id")), permission === "none" ? null : (permission as "view" | "edit"));
    // 非公開のまま共有しても相手は読めない（§5.1）ので、共有先を追加したら公開範囲を『指定した人』にする（AS-067）
    if (res.ok && permission !== "none" && note.value.visibility === "private") {
      await updateNote(supabase, id, { visibility: "shared", expected_version: note.value.version });
    }
  }
  revalidatePath(`/notes/${id}`);
  redirect(`/notes/${id}`);
}
