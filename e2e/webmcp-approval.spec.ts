// @covers AC-079, AC-080, AC-081, AC-125, AC-126
import { test, expect, type Page } from "@playwright/test";
import { closeDb, db, seedNote, seedProposal } from "./helpers";
import { exec, loginWithWebMcp, waitTools } from "./webmcp-helpers";

test.afterAll(closeDb);

async function proposal(owner: "misaki" | "kenta" = "misaki") {
  const a = await seedNote({ owner, visibility: "workspace", title: `旧規程 ${Math.random().toString(36).slice(2, 8)}` });
  const b = await seedNote({ owner: "misaki", visibility: "workspace", title: `新規程 ${Math.random().toString(36).slice(2, 8)}` });
  return { a, b, rel: await seedProposal(b.id, a.id) };
}
const state = async (id: string) => (await db().query("select state from public.note_relation where id = $1", [id])).rows[0].state;

/** request_relation_approval を開始し、結果の Promise を window.__p に置く */
async function startApproval(page: Page, relationId: string, withAbort = false) {
  await page.evaluate(
    ([id, abortable]) => {
      const w = window as unknown as { __webmcp: { execute: (n: string, i: unknown, s?: AbortSignal) => Promise<unknown> }; __p: Promise<unknown>; __ac: AbortController };
      w.__ac = new AbortController();
      w.__p = w.__webmcp.execute("request_relation_approval", { relation_id: id }, abortable ? w.__ac.signal : undefined).then(
        (v) => ({ value: v }),
        (e: Error) => ({ error: e.name }),
      );
    },
    [relationId, withAbort] as const,
  );
}
const result = (page: Page) => page.evaluate(() => (window as unknown as { __p: Promise<unknown> }).__p);

test("AC-079: request_relation_approval は承認ダイアログを表示し、人間がクリックするまで proposed のまま", async ({ browser }) => {
  const { rel } = await proposal();
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await startApproval(page, rel);
  const dialog = page.getByRole("dialog", { name: "承認の確認" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await state(rel)).toBe("proposed");
  await context.close();
});

test("AC-080: ページ内スクリプトからの click()（isTrusted=false）では承認されず proposed のまま", async ({ browser }) => {
  const { rel } = await proposal();
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await startApproval(page, rel);
  const dialog = page.getByRole("dialog", { name: "承認の確認" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "はい") as HTMLButtonElement;
    btn.click();
  });
  await page.waitForTimeout(1000);
  await expect(dialog).toBeVisible();
  expect(await state(rel)).toBe("proposed");
  await context.close();
});

test("AC-081: 美咲が『はい』をクリックすると confirmed になり、ツール結果に confirmed を返す", async ({ browser }) => {
  const { rel } = await proposal();
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  await startApproval(page, rel);
  await page.getByRole("dialog", { name: "承認の確認" }).getByRole("button", { name: "はい" }).click();
  expect(await result(page)).toEqual({ value: { state: "confirmed" } });
  expect(await state(rel)).toBe("confirmed");
  await context.close();
});

test("AC-125: 旧ノートを閲覧だけできる提案ではダイアログを表示せず FORBIDDEN を返し、proposed のまま", async ({ browser }) => {
  const { rel } = await proposal("kenta"); // 旧ノートは健太のもの（美咲は閲覧のみ）
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const r = await exec(page, "request_relation_approval", { relation_id: rel });
  expect(r).toMatchObject({ code: "FORBIDDEN" });
  await expect(page.getByRole("dialog", { name: "承認の確認" })).toHaveCount(0);
  expect(await state(rel)).toBe("proposed");
  await context.close();
});

test("AC-126: (a)『後で』は deferred、(b) signal の abort と (c) 画面遷移はダイアログを閉じて AbortError、いずれも proposed のまま", async ({ browser }) => {
  const { context, page } = await loginWithWebMcp(browser, "misaki");
  const dialog = page.getByRole("dialog", { name: "承認の確認" });

  const a = await proposal();
  await startApproval(page, a.rel);
  await dialog.getByRole("button", { name: "後で" }).click();
  expect(await result(page)).toEqual({ value: { state: "deferred" } });

  const b = await proposal();
  await startApproval(page, b.rel, true);
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as unknown as { __ac: AbortController }).__ac.abort());
  expect(await result(page)).toEqual({ error: "AbortError" });
  await expect(dialog).toHaveCount(0);

  // (c) ダイアログはページ全体を覆うので、人間が起こせる遷移は「戻る」。先に一覧へ進んでおき、承認中に戻る
  await page.getByRole("link", { name: "ノート一覧" }).click();
  await page.waitForURL(/\/notes$/);
  const c = await proposal();
  await startApproval(page, c.rel);
  await expect(dialog).toBeVisible();
  await page.goBack();
  await page.waitForURL(/\/dashboard$/);
  expect(await result(page)).toEqual({ error: "AbortError" });
  await expect(dialog).toHaveCount(0);
  await waitTools(page, 12);

  for (const r of [a.rel, b.rel, c.rel]) expect(await state(r)).toBe("proposed");
  await context.close();
});
