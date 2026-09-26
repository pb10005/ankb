// @covers AC-060, AC-062, AC-063, AC-064, AC-065, AC-066, AC-067, AC-068, AC-070, AC-119, AC-120, AC-123, AC-124
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { closeDb, db, indexSeeded, noteInDb, seedNote, seedShare, USER_ID, PASSWORD, type UserName } from "./helpers";
import { BASE, call, errorCode, expiredToken, mcpClient, tokenFor } from "./mcp-helpers";
import { AnswerSchema, SearchResultSchema, TOOL_NAMES } from "../src/mcp/server";
import { loadScenarios, loadWorkspaces, noteId } from "../src/seed/fixtures";

test.afterAll(closeDb);
test.describe.configure({ timeout: 120_000 });

const tok = () => randomUUID().replace(/-/g, "").slice(0, 10);

test("AC-060: tools/list は8件のツールだけを返す", async () => {
  const c = await mcpClient("sho");
  const { tools } = await c.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  await c.close();
});

test("AC-123: 8ツールすべてに outputSchema があり、search_knowledge と ask は §7.3 の型のスキーマ検証を通る", async () => {
  const c = await mcpClient("misaki");
  const { tools } = await c.listTools();
  for (const t of tools) expect(t.outputSchema, t.name).toBeDefined();
  const s = await call(c, "search_knowledge", { query: "出張の宿泊費の上限" });
  expect(s.isError).toBeFalsy();
  expect(SearchResultSchema.safeParse(s.structuredContent).success).toBe(true);
  const a = await call(c, "ask", { question: "出張の宿泊費の上限はいくら？" });
  expect(a.isError).toBeFalsy();
  expect(AnswerSchema.safeParse(a.structuredContent).success).toBe(true);
  await c.close();
});

test("AC-062: 閲覧できない private ノートは search_knowledge に現れず、get_note は存在しない id と同じ NOT_FOUND", async () => {
  const t = tok();
  const p = await seedNote({ owner: "misaki", visibility: "private", title: `美咲の非公開 ${t}`, body: `${t} の秘密` });
  await indexSeeded(p.id);
  const c = await mcpClient("sho");
  const s = await call(c, "search_knowledge", { query: t });
  expect(JSON.stringify(s)).not.toContain(p.id);
  const hidden = await call(c, "get_note", { note_id: p.id });
  const missing = await call(c, "get_note", { note_id: randomUUID() });
  expect(errorCode(hidden)).toBe("NOT_FOUND");
  expect(hidden.content).toEqual(missing.content);
  await c.close();
});

test("AC-063: propose_relation は state=proposed / proposed_by=agent の関係を作る", async () => {
  const a = await seedNote({ owner: "misaki", visibility: "workspace", title: `旧 ${tok()}` });
  const b = await seedNote({ owner: "kenta", visibility: "workspace", title: `新 ${tok()}` });
  const c = await mcpClient("sho");
  const r = await call(c, "propose_relation", { from_note_id: b.id, to_note_id: a.id, type: "supersedes", rationale: "新しい版のため" });
  expect(r.isError).toBeFalsy();
  const { rows } = await db().query("select state, proposed_by, type from public.note_relation where id = $1", [r.structuredContent!.id]);
  expect(rows).toEqual([{ state: "proposed", proposed_by: "agent", type: "supersedes" }]);
  await c.close();
});

test("AC-064: update_note で superseded にする・resolve_relation を呼ぶ、のどちらもエラーで提案は proposed のまま", async () => {
  const a = await seedNote({ owner: "sho", visibility: "workspace", title: `旧 ${tok()}` });
  const b = await seedNote({ owner: "sho", visibility: "workspace", title: `新 ${tok()}` });
  const c = await mcpClient("sho");
  const r = await call(c, "propose_relation", { from_note_id: b.id, to_note_id: a.id, type: "supersedes", rationale: "新しい版のため" });
  const relId = r.structuredContent!.id as string;
  const u = await call(c, "update_note", { note_id: a.id, expected_version: a.version, status: "superseded" });
  expect(u.isError).toBe(true);
  const x = await c.callTool({ name: "resolve_relation", arguments: { relation_id: relId, decision: "confirm" } }).catch((e) => ({ isError: true, error: String(e) }));
  expect((x as { isError?: boolean }).isError).toBe(true);
  expect((await db().query("select state from public.note_relation where id = $1", [relId])).rows[0].state).toBe("proposed");
  expect((await noteInDb(a.id)).status).toBe("active");
  await c.close();
});

test("AC-065: ヘッダ無し・期限切れ・署名不正・Web UI のセッション JWT は401と resource_metadata 付きの WWW-Authenticate を返しツールを実行しない", async () => {
  const title = `401検証 ${tok()}`;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_note", arguments: { title } } });
  const valid = await tokenFor("sho");
  const [h, p] = valid.split(".");
  const badSig = `${h}.${p}.${Buffer.from("not-a-signature").toString("base64url")}`;
  const expired = await expiredToken({ ...JSON.parse(Buffer.from(p, "base64url").toString()) });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(".env.local");
  const web = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const session = (await web.auth.signInWithPassword({ email: "sho@example.com", password: PASSWORD })).data.session!.access_token;
  const cases: [string, Record<string, string>][] = [
    ["(a) ヘッダ無し", {}],
    ["(b) 期限切れ", { authorization: `Bearer ${expired}` }],
    ["(c) 署名不正", { authorization: `Bearer ${badSig}` }],
    ["(d) Web UI のセッション", { authorization: `Bearer ${session}` }],
  ];
  for (const [label, headers] of cases) {
    const res = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body });
    expect(res.status, label).toBe(401);
    expect(res.headers.get("www-authenticate"), label).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  }
  expect((await db().query("select count(*)::int n from public.notes where title = $1", [title])).rows[0].n).toBe(0);
  const meta = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  expect(meta.authorization_servers).toEqual([`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`]);
});

test("AC-066: create_note は既定で private / draft、visibility を指定すると VALIDATION_ERROR で作成しない", async () => {
  const c = await mcpClient("sho");
  const t1 = `MCP作成 ${tok()}`;
  const r1 = await call(c, "create_note", { title: t1, body: "本文" });
  expect(r1.isError).toBeFalsy();
  const row = await noteInDb(r1.structuredContent!.id as string);
  expect([row.visibility, row.status, row.owner_id]).toEqual(["private", "draft", USER_ID.sho]);
  const t2 = `MCP公開指定 ${tok()}`;
  const r2 = await call(c, "create_note", { title: t2, body: "本文", visibility: "workspace" });
  expect(errorCode(r2)).toBe("VALIDATION_ERROR");
  expect((await db().query("select count(*)::int n from public.notes where title = $1", [t2])).rows[0].n).toBe(0);
  await c.close();
});

test("AC-067: view で共有されたノートの update_note は権限エラーで本文は変わらない", async () => {
  const n = await seedNote({ owner: "misaki", visibility: "shared", body: "変わってはいけない" });
  await seedShare(n.id, "sho", "view");
  const c = await mcpClient("sho");
  const r = await call(c, "update_note", { note_id: n.id, expected_version: n.version, body: "翔が書き換え" });
  expect(errorCode(r)).toBe("FORBIDDEN");
  expect((await noteInDb(n.id)).body).toBe("変わってはいけない");
  await c.close();
});

test("AC-068: 連鎖 A→B→C で B を閲覧できない翔の get_note_lineage(C) は B を含まず A と C を日付順に返す", async () => {
  const t = tok();
  const a = await seedNote({ owner: "misaki", visibility: "workspace", title: `規程A ${t}` });
  const b = await seedNote({ owner: "misaki", visibility: "private", title: `規程B ${t}` });
  const c = await seedNote({ owner: "misaki", visibility: "workspace", title: `規程C ${t}` });
  await db().query("update public.notes set effective_from = $2 where id = $1", [a.id, "2023-01-01"]);
  await db().query("update public.notes set effective_from = $2 where id = $1", [b.id, "2024-01-01"]);
  await db().query("update public.notes set effective_from = $2 where id = $1", [c.id, "2025-01-01"]);
  for (const [from, to] of [[b.id, a.id], [c.id, b.id]]) {
    const { rows } = await db().query("insert into public.note_relation (from_note_id, to_note_id, type, proposed_by, rationale) values ($1, $2, 'supersedes', 'user', 'x') returning id", [from, to]);
    await db().query("update public.note_relation set state = 'confirmed', resolved_at = clock_timestamp() where id = $1", [rows[0].id]);
  }
  const client = await mcpClient("sho");
  const r = await call(client, "get_note_lineage", { note_id: c.id });
  expect(r.isError).toBeFalsy();
  const lineage = r.structuredContent!.lineage as { note_id: string }[];
  expect(lineage.map((l) => l.note_id)).toEqual([a.id, c.id]);
  expect(JSON.stringify(r)).not.toContain(b.id);
  expect(JSON.stringify(r)).not.toContain(b.title);
  await client.close();
});

test("AC-124: get_note は status・possibly_outdated と contradicts(proposed) の conflicts を返す", async () => {
  const x = await seedNote({ owner: "misaki", visibility: "workspace", title: `X ${tok()}` });
  const y = await seedNote({ owner: "kenta", visibility: "workspace", title: `Y ${tok()}` });
  await db().query("insert into public.note_relation (from_note_id, to_note_id, type, proposed_by, rationale) values ($1, $2, 'contradicts', 'ai', '金額が違う')", [x.id, y.id]);
  const c = await mcpClient("sho");
  const r = await call(c, "get_note", { note_id: x.id });
  expect(r.structuredContent).toMatchObject({ id: x.id, status: "active", possibly_outdated: false, conflicts: [{ note_ids: [x.id, y.id], relation_state: "proposed" }] });
  await c.close();
});

test("AC-119: Anthropic API が失敗すると ask は部分的な answer を含まず UPSTREAM_ERROR を返す", async () => {
  const c = await mcpClient("misaki", { "x-ankb-test-synth": "fail" });
  const r = await call(c, "ask", { question: "出張の宿泊費の上限はいくら？" });
  expect(r.isError).toBe(true);
  expect(errorCode(r)).toBe("UPSTREAM_ERROR");
  expect(r.structuredContent).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain("citations");
  await c.close();
});

test("AC-120: OAuth で得たトークンで Supabase を直接叩いても承認と公開範囲の変更は拒否される", async () => {
  const a = await seedNote({ owner: "sho", visibility: "workspace" });
  const b = await seedNote({ owner: "sho", visibility: "workspace" });
  const { rows } = await db().query("insert into public.note_relation (from_note_id, to_note_id, type, proposed_by, rationale) values ($1, $2, 'supersedes', 'agent', 'x') returning id", [b.id, a.id]);
  const token = await tokenFor("sho");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(".env.local");
  const direct = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const r1 = await direct.rpc("resolve_relation", { p_relation_id: rows[0].id, p_decision: "confirm" });
  const r2 = await direct.from("notes").update({ visibility: "private" }).eq("id", a.id);
  expect(r1.error).not.toBeNull();
  expect(r2.error).not.toBeNull();
  expect((await db().query("select state from public.note_relation where id = $1", [rows[0].id])).rows[0].state).toBe("proposed");
  expect((await noteInDb(a.id)).visibility).toBe("workspace");
});

test("AC-070: 全ユーザー×8ツールで、閲覧できないノートの id・title・本文断片・件数が返り値に現れない", async () => {
  const ws = loadWorkspaces();
  for (const user of ["misaki", "kenta", "sho", "yuki", "outsider"] as UserName[]) {
    const memberOf = new Set(ws.workspaces.filter((w) => w.members.some((m) => m.user === user)).map((w) => w.slug));
    const invisible = loadScenarios()
      .flatMap((s) => s.notes)
      .filter((n) => !(n.owner === user || (n.visibility === "workspace" && memberOf.has(n.workspace)) || (n.visibility === "shared" && (n.shares ?? []).some((s) => s.user === user))));
    const c = await mcpClient(user);
    const target = invisible[0];
    const results = [
      await call(c, "search_knowledge", { query: "合言葉" }),
      await call(c, "search_knowledge", { query: "宿泊費の上限" }),
      await call(c, "ask", { question: "合言葉は何？" }),
      ...(await Promise.all(invisible.slice(0, 3).map((n) => call(c, "get_note", { note_id: noteId(n.slug) })))),
      ...(await Promise.all(invisible.slice(0, 3).map((n) => call(c, "get_note_lineage", { note_id: noteId(n.slug) })))),
      await call(c, "list_pending_relations"),
      await call(c, "update_note", { note_id: noteId(target.slug), expected_version: 1, body: "x" }),
      await call(c, "propose_relation", { from_note_id: noteId(target.slug), to_note_id: noteId(invisible[1]?.slug ?? target.slug), type: "related", rationale: "x" }),
      await call(c, "create_note", { title: `漏洩確認 ${tok()}` }),
    ];
    const json = JSON.stringify(results);
    for (const n of invisible) {
      expect(json, `${user}: ${n.slug}`).not.toContain(noteId(n.slug));
      expect(json, `${user}: ${n.slug}`).not.toContain(n.title);
      for (const frag of n.body.match(/合言葉は[^。]+|[0-9,]+円/g) ?? []) expect(json, `${user}: ${frag}`).not.toContain(frag);
    }
    // 見えないノートを指定した操作は、存在しない id と同じ NOT_FOUND（件数や存在を漏らさない）
    expect(errorCode(results[results.length - 3])).toBe("NOT_FOUND");
    expect(errorCode(results[results.length - 2])).toBe("NOT_FOUND");
    await c.close();
  }
});

test("AS-080: OAuth トークンで REST を直接叩いても、アーカイブ・公開指定の作成・人間を名乗る提案はできない", async () => {
  const a = await seedNote({ owner: "sho", visibility: "workspace" });
  const b = await seedNote({ owner: "sho", visibility: "workspace" });
  const token = await tokenFor("sho");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(".env.local");
  const direct = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const ws = (await db().query("select workspace_id from public.notes where id = $1", [a.id])).rows[0].workspace_id;
  const title = `直接作成 ${tok()}`;
  const r1 = await direct.from("notes").update({ status: "archived" }).eq("id", a.id);
  const r2 = await direct.from("notes").insert({ id: randomUUID(), workspace_id: ws, owner_id: USER_ID.sho, title, visibility: "workspace" });
  const r3 = await direct.from("note_relation").insert({ id: randomUUID(), from_note_id: a.id, to_note_id: b.id, type: "related", proposed_by: "user", rationale: "x" });
  for (const r of [r1, r2, r3]) expect(r.error).not.toBeNull();
  expect((await noteInDb(a.id)).status).toBe("active");
  expect((await db().query("select count(*)::int n from public.notes where title = $1", [title])).rows[0].n).toBe(0);
  expect((await db().query("select count(*)::int n from public.note_relation where from_note_id = $1 and to_note_id = $2", [a.id, b.id])).rows[0].n).toBe(0);
});

test("AS-081: /mcp は公開オリジンと異なる Origin のリクエストを 403 で拒否する", async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://evil.example", authorization: `Bearer ${await tokenFor("sho")}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(res.status).toBe(403);
});
