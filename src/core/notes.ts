// @covers AC-027, AC-033
// @covers AC-015, AC-018, AC-019, AC-020, AC-021, AC-022, AC-023, AC-024, AC-025, AC-026, AC-130, AC-131, AC-132
// @assumption AS-010
// @assumption AS-051
// @assumption AS-052
// @assumption AS-062
// @assumption AS-045
// ノートの作成・取得・更新・共有。Web UI・API・サーバMCP はすべてこの関数を通す（指示書 §1.3）。
// 権限の最終判定は DB の RLS とトリガー（schema-rls / relation-state）で行い、ここでは利用者向けのエラーに変換する。
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type Result } from "./result";
import type { NoteStatus, Visibility } from "./labels";
import { reindexNote } from "./indexing";

export type Note = {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  body: string;
  status: NoteStatus;
  visibility: Visibility;
  effective_from: string | null;
  superseded_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type NoteVersion = { version: number; title: string; body: string; created_at: string };
export type Share = { user_id: string; permission: "view" | "edit" };

const TITLE_MAX = 200;
const BODY_MAX = 100_000;
export const TITLE_REQUIRED_MESSAGE = "タイトルを入力してください";
export const CONFLICT_MESSAGE = "ほかの人が先に更新しました。再読み込みしてください";

const codePoints = (s: string) => [...s].length;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateContent(input: { title?: string; body?: string }): Result<null> {
  if (input.title !== undefined) {
    if (input.title.trim() === "") return fail("VALIDATION_ERROR", TITLE_REQUIRED_MESSAGE);
    if (codePoints(input.title) > TITLE_MAX) return fail("VALIDATION_ERROR", `タイトルは${TITLE_MAX}文字以内で入力してください`);
  }
  if (input.body !== undefined && codePoints(input.body) > BODY_MAX) {
    return fail("VALIDATION_ERROR", `本文は${BODY_MAX.toLocaleString()}文字以内で入力してください`);
  }
  return ok(null);
}

async function currentUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

export async function listMyWorkspaces(client: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data } = await client.from("workspace").select("id, name").order("name");
  return data ?? [];
}

export async function createNote(
  client: SupabaseClient,
  input: { workspace_id: string; title: string; body: string },
): Promise<Result<Note>> {
  const v = validateContent(input);
  if (!v.ok) return v;
  const uid = await currentUserId(client);
  if (!uid) return fail("FORBIDDEN", "ログインが必要です");
  // 既定は visibility=private / status=draft（DB の既定値に任せる）。
  // RETURNING は SELECT ポリシーが挿入中の行を見られず失敗するので、id をこちらで採番して挿入後に読み直す
  const id = crypto.randomUUID();
  const { error } = await client
    .from("notes")
    .insert({ id, workspace_id: input.workspace_id, owner_id: uid, title: input.title, body: input.body });
  if (error) return fail("FORBIDDEN", "このワークスペースにはノートを作成できません");
  const created = await getNote(client, id);
  if (created?.ok) await reindexNote(client, created.value);
  return created ?? fail("NOT_FOUND", "ノートが見つかりません");
}

/** 閲覧できないノートは存在しないノートと同じく null を返す（AS-051） */
export async function getNote(client: SupabaseClient, id: string): Promise<Result<Note> | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await client.from("notes_visible").select("*").eq("id", id).maybeSingle();
  return data ? ok(data as Note) : null;
}

export async function listNotes(client: SupabaseClient): Promise<Note[]> {
  const { data } = await client.from("notes_visible").select("*").neq("status", "archived").order("updated_at", { ascending: false });
  return (data ?? []) as Note[];
}

export async function canEdit(client: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await client.rpc("can_edit_note", { p_note_id: id });
  return data === true;
}

const UPDATABLE_FIELDS = ["title", "body", "effective_from", "status", "visibility", "expected_version"] as const;
type UpdateInput = {
  title?: string;
  body?: string;
  effective_from?: string | null;
  status?: "active" | "archived";
  visibility?: Visibility;
  expected_version: number;
};

/**
 * ノートを更新する。expected_version が最新でなければ CONFLICT（AS-052）。
 * 更新できないフィールド（owner_id など）を含む入力は FORBIDDEN（AS-062 / AC-130）。
 */
export async function updateNote(client: SupabaseClient, id: string, raw: Record<string, unknown>): Promise<Result<Note>> {
  const extra = Object.keys(raw).filter((k) => !(UPDATABLE_FIELDS as readonly string[]).includes(k));
  const current = await getNote(client, id);
  if (!current || !current.ok) return fail("NOT_FOUND", "ノートが見つかりません");
  const note = current.value;
  if (extra.length > 0) return fail("FORBIDDEN", `変更できない項目です: ${extra.join(", ")}`);

  const input = raw as Partial<UpdateInput>;
  if (typeof input.expected_version !== "number") return fail("VALIDATION_ERROR", "expected_version が必要です");
  const v = validateContent(input);
  if (!v.ok) return v;
  if (input.status !== undefined && !["active", "archived"].includes(input.status)) {
    return fail("VALIDATION_ERROR", "status は active または archived を指定してください");
  }
  if (input.visibility !== undefined && !["private", "shared", "workspace"].includes(input.visibility)) {
    return fail("VALIDATION_ERROR", "visibility が不正です");
  }

  if (!(await canEdit(client, id))) return fail("FORBIDDEN", "このノートを編集する権限がありません");
  const uid = await currentUserId(client);
  if (input.visibility !== undefined && input.visibility !== note.visibility && uid !== note.owner_id) {
    return fail("FORBIDDEN", "公開範囲はオーナーだけが変更できます");
  }

  const patch: Record<string, unknown> = {};
  for (const k of ["title", "body", "effective_from", "status", "visibility"] as const) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  const { error, count } = await client
    .from("notes")
    .update(patch, { count: "exact" })
    .eq("id", id)
    .eq("version", input.expected_version);
  if (error) {
    // DB のガード（不正な状態遷移・権限）で拒否された
    return fail(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  }
  if (count === 0) return fail("CONFLICT", CONFLICT_MESSAGE);
  const updated = await getNote(client, id);
  if (updated?.ok && (patch.title !== undefined || patch.body !== undefined)) await reindexNote(client, updated.value);
  return updated ?? fail("NOT_FOUND", "ノートが見つかりません");
}

export async function listVersions(client: SupabaseClient, id: string): Promise<NoteVersion[]> {
  const { data } = await client
    .from("note_version")
    .select("version, title, body, created_at")
    .eq("note_id", id)
    .order("version", { ascending: false });
  return (data ?? []) as NoteVersion[];
}

export async function listShares(client: SupabaseClient, id: string): Promise<Share[]> {
  const { data } = await client.from("note_share").select("user_id, permission").eq("note_id", id);
  return (data ?? []) as Share[];
}

export async function listColleagues(
  client: SupabaseClient,
  workspaceId: string,
): Promise<{ user_id: string; display_name: string; email: string }[]> {
  const { data } = await client
    .from("workspace_directory")
    .select("user_id, display_name, email")
    .eq("workspace_id", workspaceId)
    .order("display_name");
  return data ?? [];
}

export async function setShare(
  client: SupabaseClient,
  note: Pick<Note, "id" | "workspace_id">,
  userId: string,
  permission: "view" | "edit" | null,
): Promise<Result<null>> {
  if (permission === null) {
    const { error } = await client.from("note_share").delete().eq("note_id", note.id).eq("user_id", userId);
    return error ? fail("FORBIDDEN", "共有を解除できません") : ok(null);
  }
  const { error } = await client
    .from("note_share")
    .upsert({ note_id: note.id, workspace_id: note.workspace_id, user_id: userId, permission }, { onConflict: "note_id,user_id" });
  return error ? fail("FORBIDDEN", "共有を設定できません") : ok(null);
}
