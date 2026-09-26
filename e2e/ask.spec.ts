// @covers AC-045, AC-046
import { test, expect } from "@playwright/test";
import { closeDb, loginAs, resetAskQuota } from "./helpers";

test.afterAll(closeDb);
test.beforeEach(resetAskQuota);

const Q = "出張の宿泊費の上限はいくら？";

test("AC-045: Anthropic API が失敗すると『回答を作成できませんでした。時間をおいて再度お試しください』を表示し、部分的な回答を表示しない", async ({ browser }) => {
  const { context, page } = await loginAs(browser, "misaki");
  await context.addCookies([{ name: "ankb-test-synth", value: "fail", url: "http://127.0.0.1:3000" }]);
  await page.goto("/ask");
  await page.getByLabel("質問", { exact: true }).fill(Q);
  await page.getByRole("button", { name: "質問する" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "回答を作成できませんでした。時間をおいて再度お試しください" })).toBeVisible();
  await expect(page.getByRole("region", { name: "回答" })).toHaveCount(0);
  await expect(page.getByTestId("answer-text")).toHaveCount(0);
  await context.close();
});

test("AC-046: 引用マーカー[1]をクリックすると根拠ノートの該当チャンクを表示し、旧情報には『旧情報』ラベルを表示する", async ({ browser }) => {
  const { context, page } = await loginAs(browser, "misaki");
  await page.goto("/ask");
  await page.getByLabel("質問", { exact: true }).fill(Q);
  await page.getByRole("button", { name: "質問する" }).click();
  const answer = page.getByRole("region", { name: "回答" });
  await expect(answer).toBeVisible();
  // 前提: citations・outdated_mentions・conflicts を含む回答
  await expect(answer.getByRole("region", { name: "食い違い" })).toBeVisible();
  const marker = answer.getByRole("button", { name: /^引用\[1\]/ }).first();
  await expect(marker).toBeVisible();
  await marker.click();
  const panel = answer.getByRole("complementary", { name: "根拠" });
  await expect(panel).toBeVisible();
  const title = (await marker.getAttribute("aria-label"))!.replace(/^引用\[1\]: /, "");
  await expect(panel.getByRole("link", { name: title })).toBeVisible();
  await expect(panel.locator("pre")).toContainText("宿泊費");
  const outdated = answer.getByRole("region", { name: "旧情報" });
  await expect(outdated.getByRole("listitem").filter({ hasText: "出張規程（2023年版）" }).locator(".badge")).toHaveText("旧情報");
  await context.close();
});
