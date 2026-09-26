// @covers AC-069, AC-072, AC-073, AC-074, AC-075, AC-076, AC-077, AC-078, AC-082, AC-083, AC-084, AC-127, AC-128, AC-129, AC-134
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { closeDb, db, seedNote, USER_ID, type UserName, resetAskQuota } from "./helpers";
import { AS_027_TOOLS, exec, loginWithWebMcp, toolNames, waitTools, webmcpContext } from "./webmcp-helpers";
import { call, mcpClient } from "./mcp-helpers";
import { loadScenarios, loadWorkspaces, noteId } from "../src/seed/fixtures";

test.afterAll(closeDb);
test.beforeEach(resetAskQuota);
test.describe.configure({ timeout: 120_000 });

test("AC-072: 未ログインで /login を開いても registerTool は1回も呼ばれない", async ({ browser }) => {
  const { context, page } = await webmcpContext(browser);
  await page.goto("/login");
  await expect(page.getByRole("form", { name: "ログイン" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __webmcp: { log: { calls: string[] } } }).__webmcp.log.calls.length)).toBe(0);
  await context.close();
});

test("AC-073: ログイン済みで /dashboard を開くと registerTool の name の集合が12件と一致する", async ({ browser }) => {
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const calls = await page.evaluate(() => (window as unknown as { __webmcp: { log: { calls: string[] } } }).__webmcp.log.calls);
  expect([...new Set(calls)].sort()).toEqual([...AS_027_TOOLS].sort());
  expect((await toolNames(page)).sort()).toEqual([...AS_027_TOOLS].sort());
  await context.close();
});

test("AC-074: ログアウトすると getTools() は ankb のツールを1件も含まない", async ({ browser }) => {
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL(/\/login/);
  await waitTools(page, 0);
  expect(await toolNames(page)).toEqual([]);
  await context.close();
});

test("AC-075: ノート N を開いていると get_current_context は N の id と選択範囲の文字列を返す", async ({ browser }) => {
  const n = await seedNote({ owner: "misaki", visibility: "workspace", body: "選択される本文テキストです" });
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await page.goto(`/notes/${n.id}`);
  await waitTools(page, 12);
  await page.getByText("選択される本文テキストです").selectText();
  const r = await exec(page, "get_current_context");
  expect(r.note_id).toBe(n.id);
  expect(r.selection).toBe("選択される本文テキストです");
  await context.close();
});

test("AC-076: ノートを開いた後に検索画面で『宿泊費』を検索すると get_current_context は note_id を含まず query を返す", async ({ browser }) => {
  const n = await seedNote({ owner: "misaki", visibility: "workspace" });
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await page.goto(`/notes/${n.id}`);
  await waitTools(page, 12);
  expect((await exec(page, "get_current_context")).note_id).toBe(n.id);
  await page.goto("/search");
  await page.getByLabel("検索語").fill("宿泊費");
  await page.getByRole("button", { name: "検索" }).click();
  await page.waitForURL(/\/search\?q=/);
  await waitTools(page, 12);
  const r = await exec(page, "get_current_context");
  expect(r).not.toHaveProperty("note_id");
  expect(r.query).toBe("宿泊費");
  await context.close();
});

test("AC-077: superseded のノートを開いていると、get_note_lineage はそのノートと置き換え先を日付の昇順で返す", async ({ browser }) => {
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const old = noteId("travel-old");
  await page.goto(`/notes/${old}`);
  await waitTools(page, 12);
  const ctx = await exec(page, "get_current_context");
  expect(ctx.note_id).toBe(old);
  const r = await exec<{ lineage: { note_id: string; date: string }[] }>(page, "get_note_lineage", { note_id: ctx.note_id });
  expect(r.lineage.map((l) => l.note_id)).toEqual([old, noteId("travel-new")]);
  expect(r.lineage[0].date <= r.lineage[1].date).toBe(true);
  await context.close();
});

test("AC-078: open_compare_view(A, B) は A と B を並べた比較ビューを表示する", async ({ browser }) => {
  const a = await seedNote({ owner: "misaki", visibility: "workspace", title: `比較A ${randomUUID().slice(0, 6)}`, body: "行1\n行2" });
  const b = await seedNote({ owner: "misaki", visibility: "workspace", title: `比較B ${randomUUID().slice(0, 6)}`, body: "行1\n行3" });
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const r = await exec(page, "open_compare_view", { a: a.id, b: b.id });
  expect(r).toEqual({ opened: [a.id, b.id] });
  await page.waitForURL(/\/compare\?/);
  await expect(page.getByTestId("compare-view").getByRole("region", { name: "左のノート" }).getByRole("heading", { name: a.title })).toBeVisible();
  await expect(page.getByTestId("compare-view").getByRole("region", { name: "右のノート" }).getByRole("heading", { name: b.title })).toBeVisible();
  await context.close();
});

test("AC-082: draft_note はエディタに title と body を表示し、ノートの件数は変わらない", async ({ browser }) => {
  const before = (await db().query("select count(*)::int n from public.notes")).rows[0].n;
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const title = `下書き ${randomUUID().slice(0, 8)}`;
  const r = await exec(page, "draft_note", { title, body: "下書きの本文" });
  expect(r).toEqual({ drafted: true, saved: false });
  await page.waitForURL(/\/notes\/new$/);
  await expect(page.getByLabel("タイトル")).toHaveValue(title);
  await expect(page.getByLabel("本文（Markdown）")).toHaveValue("下書きの本文");
  expect((await db().query("select count(*)::int n from public.notes")).rows[0].n).toBe(before);
  await context.close();
});

test("AC-083: 回答を表示している画面で highlight_citation('[1]') を実行すると [1] の根拠の箇所をハイライト表示する", async ({ browser }) => {
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await page.goto("/ask");
  await waitTools(page, 12);
  await page.getByLabel("質問", { exact: true }).fill("出張の宿泊費の上限はいくら？");
  await page.getByRole("button", { name: "質問する" }).click();
  await expect(page.getByTestId("answer-text")).toBeVisible();
  const r = await exec(page, "highlight_citation", { marker: "[1]" });
  expect(r).toEqual({ highlighted: "[1]" });
  const panel = page.getByRole("complementary", { name: "根拠" });
  await expect(panel).toHaveAttribute("data-highlighted", "true");
  // 表示しているのが [1] の根拠そのものであること（見出しの marker が [1]、本文が [1] の抜粋）
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText(/^\[1\] /);
  await expect(panel.locator("pre")).toContainText("宿泊費");
  const chunk1 = await panel.locator("pre").textContent();
  // 別の marker を指定すると表示が切り替わる（[1] を固定で出しているのではない）
  expect(await exec(page, "highlight_citation", { marker: "[2]" })).toEqual({ highlighted: "[2]" });
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText(/^\[2\] /);
  expect(await panel.locator("pre").textContent()).not.toBe(chunk1);
  await context.close();
});

test("AC-084: XSS を含むタイトルのノートを open_note で開くと文字列として表示し、window.__xss は undefined のまま", async ({ browser }) => {
  const title = `<img src=x onerror=window.__xss=1> ${randomUUID().slice(0, 6)}`;
  const n = await seedNote({ owner: "misaki", visibility: "workspace", title, body: "<script>window.__xss=1</script>" });
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  expect(await exec(page, "open_note", { note_id: n.id })).toEqual({ opened: n.id });
  await page.waitForURL(new RegExp(`/notes/${n.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await context.close();
});

test("AC-134: 未保存の編集があると open_note と draft_note は UNSAVED_CHANGES を返し、エディタと画面は変わらない", async ({ browser }) => {
  const n = await seedNote({ owner: "misaki", visibility: "workspace" });
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await page.goto("/notes/new");
  await waitTools(page, 12);
  await page.getByLabel("タイトル").fill("書きかけ");
  const r1 = await exec(page, "open_note", { note_id: n.id });
  const r2 = await exec(page, "draft_note", { title: "上書き", body: "x" });
  expect(r1).toMatchObject({ code: "UNSAVED_CHANGES" });
  expect(r2).toMatchObject({ code: "UNSAVED_CHANGES" });
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/notes\/new$/);
  await expect(page.getByLabel("タイトル")).toHaveValue("書きかけ");
  await context.close();
});

test("AC-128: クライアント側で画面を行き来しても12件の name がそれぞれ1回ずつで、registerTool の例外は0件", async ({ browser }) => {
  const n = await seedNote({ owner: "misaki", visibility: "workspace", title: `遷移確認 ${randomUUID().slice(0, 6)}` });
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await page.getByRole("link", { name: "ノート一覧" }).click();
  await page.getByRole("link", { name: n.title }).click();
  await page.waitForURL(new RegExp(`/notes/${n.id}$`));
  await page.getByRole("link", { name: "ankb" }).click(); // ヘッダー → /dashboard
  await page.getByRole("link", { name: "検索する" }).click();
  await page.waitForURL(/\/search/);
  await page.getByRole("link", { name: "ankb" }).click();
  await page.waitForURL(/\/dashboard$/);
  const names = await toolNames(page);
  expect(names.sort()).toEqual([...AS_027_TOOLS].sort());
  expect(await page.evaluate(() => (window as unknown as { __webmcp: { log: { errors: string[] } } }).__webmcp.log.errors)).toEqual([]);
  await context.close();
});

test("AC-129: 別タブでログアウトするとタブ A は登録を解除し、解除前に呼ばれた execute は UNAUTHENTICATED を返す", async ({ browser }) => {
  const { context, page: a } = await loginWithWebMcp(browser, "misaki");
  const b = await context.newPage();
  await b.goto("/dashboard");
  // タブ A のツールの参照を先に取っておく（解除前の呼び出しを再現する）
  await a.evaluate(() => {
    const w = window as unknown as { __webmcp: { tools: Map<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> }; __captured: unknown };
    w.__captured = w.__webmcp.tools.get("search_knowledge");
  });
  await b.getByRole("button", { name: "ログアウト" }).click();
  await b.waitForURL(/\/login/);
  const r = await a.evaluate(() => (window as unknown as { __captured: { execute: (i: unknown, o: unknown) => Promise<unknown> } }).__captured.execute({ query: "宿泊費" }, {}));
  expect(r).toEqual({ code: "UNAUTHENTICATED", message: "ログインが必要です" });
  await waitTools(a, 0);
  await context.close();
});

test("AC-069: Web UI の検索API・サーバMCP・WebMCP の search_knowledge は同じ hits / superseded_context / conflicts を返す", async ({ browser }) => {
  const q = "出張の宿泊費の上限";
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const web = await (await page.request.get(`/api/search?q=${encodeURIComponent(q)}`)).json();
  const c = await mcpClient("misaki");
  const mcp = (await call(c, "search_knowledge", { query: q })).structuredContent!;
  await c.close();
  const webmcp = await exec(page, "search_knowledge", { query: q });
  const pick = (r: Record<string, unknown>) => ({ hits: r.hits, superseded_context: r.superseded_context, conflicts: r.conflicts });
  expect((web.hits as unknown[]).length).toBeGreaterThan(0);
  expect(pick(mcp)).toEqual(pick(web));
  expect(pick(webmcp)).toEqual(pick(web));
  await context.close();
});

/** そのユーザーとして RLS を通したときに見えるノートの id（テスト側の独立な正解） */
async function visibleNoteIds(user: UserName): Promise<Set<string>> {
  const c = await db().connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_ID[user], role: "authenticated" })]);
    const { rows } = await c.query("select id from public.notes");
    return new Set(rows.map((r) => r.id as string));
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** ツール結果に含まれるノート id（note_id / from_note_id / to_note_id / note_ids）をすべて集める */
function noteIdsIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => noteIdsIn(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if ((k === "note_id" || k === "from_note_id" || k === "to_note_id") && typeof x === "string") out.push(x);
      else if (k === "note_ids" && Array.isArray(x)) out.push(...x.filter((y): y is string => typeof y === "string"));
      else noteIdsIn(x, out);
    }
  return out;
}

test("AC-127: 各ユーザーで id を取る5ツールは不可視ノートに存在しない id と同じ NOT_FOUND を返して遷移せず、12ツールの結果に不可視ノートの情報を含まない", async ({ browser }) => {
  const ws = loadWorkspaces();
  for (const user of ["misaki", "kenta", "sho"] as UserName[]) {
    const memberOf = new Set(ws.workspaces.filter((w) => w.members.some((m) => m.user === user)).map((w) => w.slug));
    const invisible = loadScenarios()
      .flatMap((s) => s.notes)
      .filter((n) => !(n.owner === user || (n.visibility === "workspace" && memberOf.has(n.workspace)) || (n.visibility === "shared" && (n.shares ?? []).some((s) => s.user === user))));
    const hid = noteId(invisible[0].slug);
    const hid2 = noteId((invisible[1] ?? invisible[0]).slug);
    const missing = randomUUID();
    const pair = [hid, hid2 === hid ? noteId("perm-outsider-workspace") : hid2];
    // AI 提案の組は一意（このテストの前回の残りがあれば消してから作る）
    await db().query("delete from public.note_relation where proposed_by = 'ai' and rationale = '理由' and least(from_note_id, to_note_id) = least($1::uuid, $2::uuid) and greatest(from_note_id, to_note_id) = greatest($1::uuid, $2::uuid)", pair);
    const rel = (await db().query("insert into public.note_relation (from_note_id, to_note_id, type, proposed_by, rationale) values ($1, $2, 'related', 'ai', '理由') returning id", pair)).rows[0].id;
    const { context, page } = await loginWithWebMcp(browser, user);
    const url = page.url();
    const byId = async (id: string) => [
      await exec(page, "get_note", { note_id: id }),
      await exec(page, "get_note_lineage", { note_id: id }),
      await exec(page, "open_note", { note_id: id }),
      await exec(page, "open_compare_view", { a: id, b: id }),
      await exec(page, "propose_relation", { from_note_id: id, to_note_id: id === missing ? randomUUID() : hid2, type: "related", rationale: "x" }),
    ];
    const hiddenResults = await byId(hid);
    const missingResults = await byId(missing);
    // id を取る5ツールは画面を遷移させない
    await page.waitForTimeout(300);
    expect(page.url()).toBe(url);
    const others = [
      await exec(page, "search_knowledge", { query: "合言葉" }),
      await exec(page, "ask", { question: "合言葉は何？" }),
      await exec(page, "list_pending_relations"),
      await exec(page, "get_current_context"),
      await exec(page, "highlight_citation", { marker: hid }),
      await exec(page, "request_relation_approval", { relation_id: rel }),
      await exec(page, "draft_note", { title: `下書き ${hid.slice(0, 4)}`, body: "" }),
    ];
    for (const r of hiddenResults) expect(r).toMatchObject({ code: "NOT_FOUND" });
    // 不可視の id と存在しない id で、結果はオブジェクトごと同じ（message も含めて区別できない）
    expect(hiddenResults).toEqual(missingResults);
    expect(others[5]).toMatchObject({ code: "NOT_FOUND" });
    // 件数に不可視ノートを数えない: 結果に現れるノート id はすべて、そのユーザーが RLS で見えるものだけ
    const visible = await visibleNoteIds(user);
    const referenced = noteIdsIn(others);
    expect(referenced.length, `${user}: 検索・回答・提案一覧がノートを返している`).toBeGreaterThan(0);
    for (const id of referenced) expect(visible.has(id), `${user}: ${id} は見えないノート`).toBe(true);
    const pending = (others[2] as { relations: { id: string }[] }).relations;
    expect(pending.map((r) => r.id)).not.toContain(rel);
    const json = JSON.stringify([...hiddenResults, ...others]);
    for (const n of invisible) {
      expect(json, `${user}: ${n.slug}`).not.toContain(noteId(n.slug));
      expect(json, `${user}: ${n.slug}`).not.toContain(n.title);
      for (const frag of n.body.match(/合言葉は[^。]+|[0-9,]+円/g) ?? []) expect(json, `${user}: ${frag}`).not.toContain(frag);
    }
    await context.close();
  }
});
