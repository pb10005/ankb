// @covers AC-140
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { closeDb, indexSeeded, loginAs, seedNote, seedProposal } from "./helpers";
import { noteId } from "../src/seed/fixtures";

test.afterAll(closeDb);

test("AC-140: 検索画面は hits を一覧し、possibly_outdated に『更新されている可能性』、superseded_context を別の『古い情報』欄に『旧情報』付きで表示する", async ({ browser }) => {
  // 置き換えが提案中（proposed）のノート → possibly_outdated
  const tok = `検索画面${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const outdated = await seedNote({ owner: "misaki", visibility: "workspace", title: `${tok} 旧手順`, body: `${tok} の旧手順` });
  const newer = await seedNote({ owner: "misaki", visibility: "workspace", title: `${tok} 新手順`, body: `${tok} の新手順` });
  await indexSeeded(outdated.id);
  await indexSeeded(newer.id);
  await seedProposal(newer.id, outdated.id);

  const { context, page } = await loginAs(browser, "misaki");
  await page.goto(`/search?q=${encodeURIComponent(tok)}`);
  const results = page.getByRole("list", { name: "検索結果" });
  const itemOf = (title: string) => results.getByRole("listitem").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await expect(itemOf(outdated.title)).toContainText("更新されている可能性");
  await expect(itemOf(newer.title)).toBeVisible();
  await expect(itemOf(newer.title)).not.toContainText("更新されている可能性");

  // 置き換え済み（superseded）のノート → 検索結果とは別の『古い情報』欄
  await page.goto(`/search?q=${encodeURIComponent("宿泊費")}`);
  const hits = page.getByRole("list", { name: "検索結果" });
  const old = page.getByRole("region", { name: "旧情報" });
  const oldHref = `[href="/notes/${noteId("travel-old")}"]`;
  await expect(hits.locator(`[href="/notes/${noteId("travel-new")}"]`).first()).toBeVisible();
  await expect(old.getByRole("heading", { name: "古い情報" })).toBeVisible();
  await expect(old.locator(oldHref).first()).toBeVisible();
  await expect(old.getByRole("listitem").filter({ has: page.locator(oldHref) }).first()).toContainText("旧情報");
  await expect(hits.locator(oldHref)).toHaveCount(0);
  await context.close();
});
