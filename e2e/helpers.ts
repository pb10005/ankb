// @covers AC-018, AC-019, AC-020, AC-021, AC-130, AC-131, AC-132
import type { Browser, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { fillLogin } from "./fixtures";

export type UserName = "misaki" | "kenta" | "sho" | "yuki" | "outsider";
export const PASSWORD = "ankb-local-password";
export const USER_ID: Record<UserName, string> = {
  misaki: "11111111-1111-4111-8111-111111111111",
  kenta: "22222222-2222-4222-8222-222222222222",
  sho: "33333333-3333-4333-8333-333333333333",
  yuki: "44444444-4444-4444-8444-444444444444",
  outsider: "55555555-5555-4555-8555-555555555555",
};

let pool: pg.Pool | undefined;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", max: 2 });
  return pool;
}
export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

export async function loginAs(browser: Browser, user: UserName): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await fillLogin(page, `${user}@example.com`, PASSWORD);
  await page.waitForURL(/\/dashboard$/);
  return { context, page };
}

async function workspaceOf(user: UserName): Promise<string> {
  const { rows } = await db().query("select workspace_id from public.member where user_id = $1 order by workspace_id limit 1", [USER_ID[user]]);
  return rows[0].workspace_id;
}

let seq = 0;
/** 前提データの作成（RLS を通さない）。判定は画面と API の応答で行う */
export async function seedNote(opts: { owner: UserName; visibility?: string; status?: string; title?: string; body?: string }) {
  const title = opts.title ?? `E2E ノート ${Date.now()}-${++seq}`;
  const { rows } = await db().query(
    `insert into public.notes (workspace_id, owner_id, title, body, status, visibility)
     values ($1, $2, $3, $4, $5, $6) returning id, title, version`,
    [await workspaceOf(opts.owner), USER_ID[opts.owner], title, opts.body ?? "E2E の本文", opts.status ?? "active", opts.visibility ?? "private"],
  );
  return rows[0] as { id: string; title: string; version: number };
}

export async function seedShare(noteId: string, user: UserName, permission: "view" | "edit") {
  await db().query(
    `insert into public.note_share (note_id, workspace_id, user_id, permission)
     select id, workspace_id, $2, $3 from public.notes where id = $1`,
    [noteId, USER_ID[user], permission],
  );
}

export async function noteInDb(id: string) {
  const { rows } = await db().query("select * from public.notes where id = $1", [id]);
  return rows[0];
}
