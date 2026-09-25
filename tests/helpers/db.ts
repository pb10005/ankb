// @covers AC-006, AC-016
// DB 結合テストの共通部品。
// - asUser(): シード済みユーザーでログインした Supabase クライアント（RLS が効く本物の JWT）
// - admin: 前提データを作るための Postgres 直結（RLS を通らない）。判定には使わない
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { loadTestEnv } from "./env";
import { loadWorkspaces, workspaceId } from "../../src/seed/fixtures";

export type UserName = "misaki" | "kenta" | "sho" | "yuki" | "outsider";
export const PASSWORD = "ankb-local-password";

const env = loadTestEnv();
const ws = loadWorkspaces();
export const uid = (u: UserName) => ws.users[u];
export const SAMPLE_WS = workspaceId("sample-shoji");
export const OTHER_WS = workspaceId("other-company");

const clients = new Map<UserName, SupabaseClient>();

export async function asUser(u: UserName): Promise<SupabaseClient> {
  const cached = clients.get(u);
  if (cached) return cached;
  const c = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: `${u}@example.com`, password: PASSWORD });
  if (error) throw new Error(`${u} のログインに失敗: ${error.message}`);
  clients.set(u, c);
  return c;
}

export function asAnon(): SupabaseClient {
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

let pool: pg.Pool | undefined;
export function admin(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: env.databaseUrl, max: 4 });
  return pool;
}
export async function closeAdmin(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

let seq = 0;
export async function createNote(opts: {
  owner: UserName;
  visibility?: "private" | "shared" | "workspace";
  status?: "draft" | "active";
  title?: string;
  body?: string;
  workspace?: string;
}): Promise<string> {
  const title = opts.title ?? `テスト用ノート ${Date.now()}-${++seq}`;
  const { rows } = await admin().query(
    `insert into public.notes (workspace_id, owner_id, title, body, status, visibility)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [opts.workspace ?? SAMPLE_WS, uid(opts.owner), title, opts.body ?? "本文", opts.status ?? "active", opts.visibility ?? "workspace"],
  );
  return rows[0].id;
}

export async function share(noteId: string, u: UserName, permission: "view" | "edit", workspace = SAMPLE_WS): Promise<void> {
  await admin().query(
    "insert into public.note_share (note_id, workspace_id, user_id, permission) values ($1, $2, $3, $4)",
    [noteId, workspace, uid(u), permission],
  );
}

/** 提案を作り、必要なら状態遷移トリガー経由で confirmed / rejected にする */
export async function relate(from: string, to: string, type: "supersedes" | "contradicts" | "related", state: "proposed" | "confirmed" = "proposed", resolvedBy: UserName = "misaki"): Promise<string> {
  const { rows } = await admin().query(
    `insert into public.note_relation (from_note_id, to_note_id, type, proposed_by, rationale)
     values ($1, $2, $3, 'user', 'テスト') returning id`,
    [from, to, type],
  );
  if (state === "confirmed") {
    await admin().query(
      "update public.note_relation set state = 'confirmed', resolved_by = $2, resolved_at = clock_timestamp() where id = $1",
      [rows[0].id, uid(resolvedBy)],
    );
  }
  return rows[0].id;
}

export async function noteRow(id: string): Promise<{ status: string; superseded_by: string | null; version: number; body: string; visibility: string; owner_id: string; workspace_id: string; title: string }> {
  const { rows } = await admin().query("select * from public.notes where id = $1", [id]);
  return rows[0];
}

export async function relationRow(id: string): Promise<{ state: string; resolved_by: string | null }> {
  const { rows } = await admin().query("select * from public.note_relation where id = $1", [id]);
  return rows[0];
}
