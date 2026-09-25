// @covers AC-018, AC-019, AC-020, AC-021, AC-022, AC-023, AC-024, AC-025, AC-026, AC-130, AC-131, AC-132
import { test, expect } from "@playwright/test";
import { closeDb, db, loginAs, noteInDb, seedNote, seedShare, USER_ID } from "./helpers";

test.afterAll(closeDb);

test("AC-018: 新規ノートを保存するとノート画面に『非公開』と『下書き』を表示し、DB は private / draft", async ({ browser }) => {
  const { page, context } = await loginAs(browser, "misaki");
  const title = `新規作成テスト ${Date.now()}`;
  await page.goto("/notes/new");
  await page.getByLabel("タイトル").fill(title);
  await page.getByLabel("本文（Markdown）").fill("新しいノートの本文");
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator(".badge", { hasText: "非公開" })).toBeVisible();
  await expect(page.locator(".badge", { hasText: "下書き" })).toBeVisible();
  const id = page.url().split("/").pop()!;
  const row = await noteInDb(id);
  expect([row.visibility, row.status]).toEqual(["private", "draft"]);
  await context.close();
});

test("AC-019: 美咲が公開範囲を『チーム全体』に変えると、健太のノート一覧にそのノートが表示される", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", visibility: "private" });
  const kenta = await loginAs(browser, "kenta");
  await kenta.page.goto("/notes");
  await expect(kenta.page.getByRole("link", { name: note.title })).toHaveCount(0);

  const misaki = await loginAs(browser, "misaki");
  await misaki.page.goto(`/notes/${note.id}`);
  await misaki.page.getByLabel("公開範囲", { exact: true }).selectOption({ label: "チーム全体" });
  await misaki.page.getByRole("button", { name: "公開範囲を変更" }).click();
  await expect(misaki.page.locator(".badge", { hasText: "チーム全体" })).toBeVisible();

  await kenta.page.goto("/notes");
  await expect(kenta.page.getByRole("list", { name: "ノート一覧" }).getByRole("link", { name: note.title })).toBeVisible();
  await Promise.all([kenta.context.close(), misaki.context.close()]);
});

test("AC-020: 美咲が健太を『閲覧のみ』で共有すると、健太の画面に本文を表示し編集ボタンは表示しない", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", visibility: "private", body: "健太に見せる本文です" });
  const misaki = await loginAs(browser, "misaki");
  await misaki.page.goto(`/notes/${note.id}`);
  await misaki.page.getByLabel("健太との共有", { exact: true }).selectOption({ label: "閲覧のみ" });
  await misaki.page.getByRole("button", { name: "健太との共有を保存" }).click();
  await expect(misaki.page.getByLabel("健太との共有", { exact: true })).toHaveValue("view");

  const kenta = await loginAs(browser, "kenta");
  await kenta.page.goto(`/notes/${note.id}`);
  await expect(kenta.page.getByText("健太に見せる本文です")).toBeVisible();
  await expect(kenta.page.getByRole("link", { name: "編集" })).toHaveCount(0);
  await expect(kenta.page.getByRole("button", { name: "編集" })).toHaveCount(0);
  await Promise.all([kenta.context.close(), misaki.context.close()]);
});

test("AC-021: 閲覧のみで共有された健太がノート更新APIを直接呼ぶと403で本文は変わらない", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", visibility: "shared", body: "変わってはいけない本文" });
  await seedShare(note.id, "kenta", "view");
  const kenta = await loginAs(browser, "kenta");
  const res = await kenta.page.request.patch(`/api/notes/${note.id}`, { data: { body: "健太が書き換え", expected_version: note.version } });
  expect(res.status()).toBe(403);
  expect((await noteInDb(note.id)).body).toBe("変わってはいけない本文");
  await kenta.context.close();
});

test("AC-130: edit 共有の健太が更新APIに visibility=workspace / owner_id=健太 を送ると403で値は変わらない", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", visibility: "shared" });
  await seedShare(note.id, "kenta", "edit");
  const kenta = await loginAs(browser, "kenta");
  const r1 = await kenta.page.request.patch(`/api/notes/${note.id}`, { data: { visibility: "workspace", expected_version: note.version } });
  const r2 = await kenta.page.request.patch(`/api/notes/${note.id}`, { data: { owner_id: USER_ID.kenta, expected_version: note.version } });
  expect(r1.status()).toBe(403);
  expect(r2.status()).toBe(403);
  const row = await noteInDb(note.id);
  expect([row.visibility, row.owner_id]).toEqual(["shared", USER_ID.misaki]);
  await kenta.context.close();
});

test("AC-022: 本文を編集して保存すると、版履歴に編集前の本文を日時付きで表示する", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", body: "編集前の本文" });
  const misaki = await loginAs(browser, "misaki");
  await misaki.page.goto(`/notes/${note.id}/edit`);
  await misaki.page.getByLabel("本文（Markdown）").fill("編集後の本文");
  await misaki.page.getByRole("button", { name: "保存" }).click();
  await misaki.page.waitForURL(new RegExp(`/notes/${note.id}$`));
  await expect(misaki.page.getByText("編集後の本文")).toBeVisible();
  await misaki.page.getByRole("link", { name: "版履歴" }).click();
  const history = misaki.page.getByRole("list", { name: "版履歴" });
  await expect(history.getByText("編集前の本文")).toBeVisible();
  await expect(history.locator("time")).toHaveCount(1);
  await expect(history.locator("time")).toHaveText(/\d{4}\/\d{1,2}\/\d{1,2}/);
  await misaki.context.close();
});

test("AC-023: タイトルを空のまま保存すると『タイトルを入力してください』を表示しノートを保存しない", async ({ browser }) => {
  const misaki = await loginAs(browser, "misaki");
  const body = `タイトル無しの本文 ${Date.now()}`;
  await misaki.page.goto("/notes/new");
  await misaki.page.getByLabel("本文（Markdown）").fill(body);
  await misaki.page.getByRole("button", { name: "保存" }).click();
  await expect(misaki.page.getByRole("form", { name: "ノートの編集" }).getByRole("alert")).toHaveText("タイトルを入力してください");
  await expect(misaki.page).toHaveURL(/\/notes\/new$/);
  const { rows } = await db().query("select count(*)::int n from public.notes where body = $1", [body]);
  expect(rows[0].n).toBe(0);
  await misaki.context.close();
});

test("AC-024: 有効なノートを『アーカイブ』すると status=archived になり既定のノート一覧に表示しない", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", status: "active", visibility: "workspace" });
  const misaki = await loginAs(browser, "misaki");
  await misaki.page.goto("/notes");
  await expect(misaki.page.getByRole("link", { name: note.title })).toBeVisible();
  await misaki.page.goto(`/notes/${note.id}`);
  await misaki.page.getByRole("button", { name: "アーカイブ" }).click();
  await expect(misaki.page.locator(".badge", { hasText: "アーカイブ済み" })).toBeVisible();
  expect((await noteInDb(note.id)).status).toBe("archived");
  await misaki.page.goto("/notes");
  await expect(misaki.page.getByRole("link", { name: note.title })).toHaveCount(0);
  await misaki.context.close();
});

test("AC-025: 下書きを『公開する（有効にする）』と status=active になり『下書き』表示が消える", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", status: "draft" });
  const misaki = await loginAs(browser, "misaki");
  await misaki.page.goto(`/notes/${note.id}`);
  await expect(misaki.page.locator(".badge", { hasText: "下書き" })).toBeVisible();
  await misaki.page.getByRole("button", { name: "公開する（有効にする）" }).click();
  await expect(misaki.page.getByRole("button", { name: "アーカイブ" })).toBeVisible();
  await expect(misaki.page.locator(".badge", { hasText: "下書き" })).toHaveCount(0);
  expect((await noteInDb(note.id)).status).toBe("active");
  await misaki.context.close();
});

test("AC-026: 健太の画面には（edit 共有でも）公開範囲と共有の設定ボタンを表示しない", async ({ browser }) => {
  const viewNote = await seedNote({ owner: "misaki", visibility: "shared" });
  const editNote = await seedNote({ owner: "misaki", visibility: "shared" });
  await seedShare(viewNote.id, "kenta", "view");
  await seedShare(editNote.id, "kenta", "edit");
  const kenta = await loginAs(browser, "kenta");
  for (const n of [viewNote, editNote]) {
    await kenta.page.goto(`/notes/${n.id}`);
    await expect(kenta.page.getByRole("heading", { level: 1 })).toHaveText(n.title);
    await expect(kenta.page.getByRole("region", { name: "公開範囲と共有" })).toHaveCount(0);
    await expect(kenta.page.getByRole("button", { name: "公開範囲を変更" })).toHaveCount(0);
    await expect(kenta.page.getByLabel("公開範囲", { exact: true })).toHaveCount(0);
    await expect(kenta.page.getByRole("button", { name: /との共有を保存/ })).toHaveCount(0);
  }
  // edit 共有なら編集ボタンは出る（公開範囲の設定だけが無い）
  await expect(kenta.page.getByRole("link", { name: "編集" })).toBeVisible();
  await kenta.context.close();
});

test("AC-131: 閲覧できないノートを開くと、存在しない id と同じ 404 画面を表示する", async ({ browser }) => {
  const hidden = await seedNote({ owner: "misaki", visibility: "private", title: `健太には見えない ${Date.now()}` });
  const kenta = await loginAs(browser, "kenta");
  const r1 = await kenta.page.goto(`/notes/${hidden.id}`);
  const hiddenText = await kenta.page.locator("body").innerText();
  const r2 = await kenta.page.goto("/notes/00000000-0000-4000-8000-000000000000");
  const missingText = await kenta.page.locator("body").innerText();
  expect(r1?.status()).toBe(404);
  expect(r2?.status()).toBe(404);
  expect(hiddenText).toBe(missingText);
  expect(hiddenText).not.toContain(hidden.title);
  await kenta.context.close();
});

test("AC-132: 同じ版を開いた2人のうち後から保存した翔に『ほかの人が先に更新しました。再読み込みしてください』を表示し、美咲の保存内容は変わらない", async ({ browser }) => {
  const note = await seedNote({ owner: "misaki", visibility: "shared", body: "元の本文" });
  await seedShare(note.id, "sho", "edit");
  await db().query("update public.notes set body = body || ' ' where id = $1", [note.id]);
  await db().query("update public.notes set body = rtrim(body) where id = $1", [note.id]);
  expect((await noteInDb(note.id)).version).toBe(3);

  const misaki = await loginAs(browser, "misaki");
  const sho = await loginAs(browser, "sho");
  await misaki.page.goto(`/notes/${note.id}/edit`);
  await sho.page.goto(`/notes/${note.id}/edit`);

  await misaki.page.getByLabel("本文（Markdown）").fill("美咲の保存内容");
  await misaki.page.getByRole("button", { name: "保存" }).click();
  await misaki.page.waitForURL(new RegExp(`/notes/${note.id}$`));

  await sho.page.getByLabel("本文（Markdown）").fill("翔の保存内容");
  await sho.page.getByRole("button", { name: "保存" }).click();
  await expect(sho.page.getByRole("form", { name: "ノートの編集" }).getByRole("alert")).toHaveText(
    "ほかの人が先に更新しました。再読み込みしてください",
  );
  expect((await noteInDb(note.id)).body).toBe("美咲の保存内容");
  await Promise.all([misaki.context.close(), sho.context.close()]);
});
