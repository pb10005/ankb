// @covers AC-049, AC-050, AC-051, AC-052, AC-053, AC-056, AC-057, AC-058, AC-112, AC-116
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { closeDb, db, indexSeeded, loginAs, noteInDb, seedNote, seedProposal, USER_ID, PASSWORD } from "./helpers";
import { searchKnowledge } from "../src/core/search";
import { StubEmbedder } from "../src/core/embedding";
import { NoopQueryExpander } from "../src/core/query-expansion";

test.afterAll(closeDb);
// バナーが出るまで最大60秒待つテストがあるため
test.describe.configure({ timeout: 120_000 });

/** 美咲の JWT で PostgREST を直接呼ぶクライアント（API レスポンスの確認用） */
async function misakiClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(".env.local");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email: "misaki@example.com", password: PASSWORD });
  return client;
}

const tok = () => randomUUID().replace(/-/g, "").slice(0, 10);

async function reloadUntil(page: Page, url: string, check: () => Promise<boolean>, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.goto(url);
    if (await check()) return Date.now() - t0;
    await page.waitForTimeout(1000);
  }
  throw new Error(`${timeoutMs}ms 以内に条件を満たさなかった`);
}

async function pair(t: string, opts: { oldOwner?: "misaki" | "kenta"; newOwner?: "misaki" | "kenta"; newStatus?: string } = {}) {
  const old = await seedNote({ owner: opts.oldOwner ?? "misaki", visibility: "workspace", status: "active", title: `旧・出張規程 ${t}`, body: `# 宿泊費\n${t} 宿泊費の上限は1泊10,000円\n日当は2,000円` });
  const nw = await seedNote({ owner: opts.newOwner ?? "misaki", visibility: "workspace", status: opts.newStatus ?? "active", title: `新・出張規程 ${t}`, body: `# 宿泊費\n${t} 宿泊費の上限は1泊12,000円\n日当は2,000円` });
  await indexSeeded(old.id);
  await indexSeeded(nw.id);
  return { old, nw };
}

test("AC-049: 新しい規程ノートを active にすると60秒以内に置き換えを尋ねるバナーを表示する", async ({ browser }) => {
  await db().query("select pgmq.purge_queue('relation_inference')");
  const t = tok();
  const { old, nw } = await pair(t, { newStatus: "draft" });
  const { page, context } = await loginAs(browser, "misaki");
  await page.goto(`/notes/${nw.id}`);
  await page.getByRole("button", { name: "公開する（有効にする）" }).click();
  await expect(page.getByRole("button", { name: "アーカイブ" })).toBeVisible();
  const message = `このノートは「${old.title}」を置き換えるものですか？`;
  const elapsed = await reloadUntil(page, `/notes/${nw.id}`, async () => (await page.getByText(message).count()) > 0);
  expect(elapsed).toBeLessThanOrEqual(60_000);
  await expect(page.getByRole("region", { name: "提案" }).getByText(message)).toBeVisible();
  await context.close();
});

test("AC-050: バナーで『はい』を押すと旧ノートが superseded になり、以後の検索で superseded_context に返る", async ({ browser }) => {
  const t = tok();
  const { old, nw } = await pair(t);
  await seedProposal(nw.id, old.id);
  const { page, context } = await loginAs(browser, "misaki");
  await page.goto(`/notes/${nw.id}`);
  await page.getByRole("region", { name: "提案" }).getByRole("button", { name: "はい" }).click();
  await expect(page.getByRole("region", { name: "提案" })).toHaveCount(0);
  expect((await noteInDb(old.id)).status).toBe("superseded");
  const client = await misakiClient();
  const r = await searchKnowledge(client, `${t} 宿泊費`, { embedder: new StubEmbedder(), expander: new NoopQueryExpander() });
  expect(r.hits.map((h) => h.note_id)).not.toContain(old.id);
  expect(r.superseded_context.find((h) => h.note_id === old.id)?.superseded_by).toBe(nw.id);
  await context.close();
});

test("AC-051: 『いいえ』を押すと提案は rejected になり、新ノートを再度保存しても同じ組の提案は作られない", async ({ browser }) => {
  const t = tok();
  const { old, nw } = await pair(t);
  const rel = await seedProposal(nw.id, old.id);
  const { page, context } = await loginAs(browser, "misaki");
  await page.goto(`/notes/${nw.id}`);
  await page.getByRole("region", { name: "提案" }).getByRole("button", { name: "いいえ" }).click();
  await expect(page.getByRole("region", { name: "提案" })).toHaveCount(0);
  expect((await db().query("select state from public.note_relation where id = $1", [rel])).rows[0].state).toBe("rejected");
  await page.goto(`/notes/${nw.id}/edit`);
  await page.getByLabel("本文（Markdown）").fill(`# 宿泊費\n${t} 宿泊費の上限は1泊12,000円（再保存）`);
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForURL(new RegExp(`/notes/${nw.id}$`));
  // 推定が走り終わるのを待つ（キューが空になる）
  await expect.poll(async () => (await db().query("select count(*)::int n from pgmq.q_relation_inference")).rows[0].n, { timeout: 30_000 }).toBe(0);
  const { rows } = await db().query(
    "select state from public.note_relation where least(from_note_id, to_note_id) = least($1::uuid, $2::uuid) and greatest(from_note_id, to_note_id) = greatest($1::uuid, $2::uuid)",
    [nw.id, old.id],
  );
  expect(rows).toEqual([{ state: "rejected" }]);
  await context.close();
});

test("AC-052: 旧ノートを閲覧だけできるユーザーには提案の内容を表示し、『はい』『いいえ』は表示しない", async ({ browser }) => {
  const t = tok();
  const { old, nw } = await pair(t, { oldOwner: "misaki", newOwner: "kenta" });
  await seedProposal(nw.id, old.id);
  const { page, context } = await loginAs(browser, "kenta");
  await page.goto(`/notes/${nw.id}`);
  const banner = page.getByRole("region", { name: "提案" });
  await expect(banner.getByText(`このノートは「${old.title}」を置き換えるものですか？`)).toBeVisible();
  await expect(banner.getByRole("button", { name: "はい" })).toHaveCount(0);
  await expect(banner.getByRole("button", { name: "いいえ" })).toHaveCount(0);
  await context.close();
});

test("AC-053: 片方を閲覧できない提案はヘッダーの件数に含めず、インボックスにも表示しない", async ({ browser }) => {
  const t = tok();
  const visible = await seedNote({ owner: "kenta", visibility: "workspace", title: `健太の公開 ${t}` });
  const hidden = await seedNote({ owner: "misaki", visibility: "private", title: `美咲の非公開 ${t}` });
  await seedProposal(hidden.id, visible.id);
  const { page, context } = await loginAs(browser, "kenta");
  await page.goto("/inbox");
  const items = page.getByRole("list", { name: "未処理の提案" }).getByRole("listitem");
  const count = Number(await page.getByTestId("pending-count").innerText());
  expect(await items.count()).toBe(count);
  await expect(page.getByText(hidden.title)).toHaveCount(0);
  expect(await page.content()).not.toContain(hidden.id);
  await context.close();
});

test("AC-056: 未処理の提案3件をインボックスで一括『いいえ』にすると3件とも rejected になり件数は0", async ({ browser }) => {
  // 前提づくり: 翔の未処理の提案をちょうど3件にする
  await db().query(
    `update public.note_relation r set state = 'rejected', resolved_at = now()
     where state = 'proposed' and exists (select 1 from public.notes n where n.id in (r.from_note_id, r.to_note_id) and n.owner_id = $1)`,
    [USER_ID.sho],
  );
  const t = tok();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const a = await seedNote({ owner: "sho", visibility: "workspace", title: `翔の旧 ${t}-${i}` });
    const b = await seedNote({ owner: "sho", visibility: "workspace", title: `翔の新 ${t}-${i}` });
    ids.push(await seedProposal(b.id, a.id));
  }
  const { page, context } = await loginAs(browser, "sho");
  await page.goto("/inbox");
  await expect(page.getByTestId("pending-count")).toHaveText("3");
  await expect(page.getByRole("list", { name: "未処理の提案" }).getByRole("listitem")).toHaveCount(3);
  for (const box of await page.getByRole("list", { name: "未処理の提案" }).getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "選択した提案を却下（いいえ）" }).click();
  await expect(page.getByText("未処理の提案はありません。")).toBeVisible();
  await expect(page.getByTestId("pending-count")).toHaveText("0");
  const { rows } = await db().query("select state from public.note_relation where id = any($1)", [ids]);
  expect(rows.map((r) => r.state)).toEqual(["rejected", "rejected", "rejected"]);
  await context.close();
});

test("AC-057: 『比較する』を押すと2つのノートを左右に並べ、差分の行をハイライトした比較ビューを表示する", async ({ browser }) => {
  const t = tok();
  const { old, nw } = await pair(t);
  await seedProposal(nw.id, old.id);
  const { page, context } = await loginAs(browser, "misaki");
  await page.goto(`/notes/${nw.id}`);
  await page.getByRole("region", { name: "提案" }).getByRole("link", { name: "比較する" }).click();
  const view = page.getByTestId("compare-view");
  await expect(view).toBeVisible();
  const left = view.getByRole("region", { name: "左のノート" });
  const right = view.getByRole("region", { name: "右のノート" });
  await expect(left.getByRole("heading", { name: nw.title })).toBeVisible();
  await expect(right.getByRole("heading", { name: old.title })).toBeVisible();
  // 左右に並んでいる
  const lb = (await left.boundingBox())!;
  const rb = (await right.boundingBox())!;
  expect(rb.x).toBeGreaterThan(lb.x + lb.width / 2);
  // 金額の行だけハイライトされ、共通の行（日当）はハイライトされない
  await expect(left.locator("[data-changed]")).toContainText(["12,000円"]);
  await expect(right.locator("[data-changed]")).toContainText(["10,000円"]);
  await expect(left.locator("div", { hasText: "日当は2,000円" })).not.toHaveAttribute("data-changed", "true");
  expect(await left.locator(".diff-changed").first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await context.close();
});

test("AC-058: 『後で』を押すと提案は proposed のまま、インボックスと件数に引き続き表示する", async ({ browser }) => {
  const t = tok();
  const { old, nw } = await pair(t);
  const rel = await seedProposal(nw.id, old.id);
  const { page, context } = await loginAs(browser, "misaki");
  await page.goto("/inbox");
  const before = Number(await page.getByTestId("pending-count").innerText());
  await page.goto(`/notes/${nw.id}`);
  await page.getByRole("region", { name: "提案" }).getByRole("button", { name: "後で" }).click();
  await expect(page.getByRole("region", { name: "提案" })).toHaveCount(0);
  expect((await db().query("select state from public.note_relation where id = $1", [rel])).rows[0].state).toBe("proposed");
  await page.goto("/inbox");
  await expect(page.getByTestId("pending-count")).toHaveText(String(before));
  await expect(page.getByRole("list", { name: "未処理の提案" }).getByText(nw.title)).toBeVisible();
  await context.close();
});

test("AC-112: 閲覧できないノートとの AI 提案はバナーを表示せず、HTML と API レスポンスに相手の id・タイトル・理由を含まない", async ({ browser }) => {
  const t = tok();
  const p = await seedNote({ owner: "kenta", visibility: "private", title: `健太の非公開規程 ${t}` });
  const n = await seedNote({ owner: "misaki", visibility: "workspace", title: `美咲の新規程 ${t}` });
  const rationale = `非公開の理由 ${t}`;
  await seedProposal(n.id, p.id, "supersedes", rationale);
  const { page, context } = await loginAs(browser, "misaki");
  const res = await page.goto(`/notes/${n.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(n.title);
  await expect(page.getByRole("region", { name: "提案" })).toHaveCount(0);
  const html = (await res!.text()) + (await page.content());
  for (const s of [p.id, p.title, rationale]) expect(html).not.toContain(s);
  const client = await misakiClient();
  const api = JSON.stringify([await client.rpc("pending_relations"), await client.from("note_relation").select("*").or(`from_note_id.eq.${n.id},to_note_id.eq.${n.id}`)]);
  for (const s of [p.id, p.title, rationale]) expect(api).not.toContain(s);
  await context.close();
});

test("AC-116: contradicts の提案は『内容が食い違っています』と表示し、『はい』で confirmed になり両ノートは active のまま", async ({ browser }) => {
  await db().query("select pgmq.purge_queue('relation_inference')");
  const t = tok();
  const a = await seedNote({ owner: "misaki", visibility: "workspace", status: "active", title: `矛盾する規程A ${t}`, body: `${t} 宿泊費の上限は12,000円` });
  const b = await seedNote({ owner: "misaki", visibility: "workspace", status: "draft", title: `矛盾する規程B ${t}`, body: `${t} 宿泊費の上限は13,000円` });
  await indexSeeded(a.id);
  await indexSeeded(b.id);
  const { page, context } = await loginAs(browser, "misaki");
  await page.goto(`/notes/${b.id}`);
  await page.getByRole("button", { name: "公開する（有効にする）" }).click();
  const message = `このノートは「${a.title}」と内容が食い違っています`;
  await reloadUntil(page, `/notes/${b.id}`, async () => (await page.getByText(message).count()) > 0);
  const banner = page.getByRole("region", { name: "提案" }).filter({ hasText: message });
  await banner.getByRole("button", { name: "はい" }).click();
  await expect(page.getByRole("region", { name: "提案" }).filter({ hasText: message })).toHaveCount(0);
  const { rows } = await db().query(
    "select state, type from public.note_relation where least(from_note_id, to_note_id) = least($1::uuid, $2::uuid) and greatest(from_note_id, to_note_id) = greatest($1::uuid, $2::uuid)",
    [a.id, b.id],
  );
  expect(rows).toEqual([{ state: "confirmed", type: "contradicts" }]);
  expect([(await noteInDb(a.id)).status, (await noteInDb(b.id)).status]).toEqual(["active", "active"]);
  await context.close();
});
