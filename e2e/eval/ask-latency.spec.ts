// @covers AC-048
// 実 Claude API を使う計測（npm run test:e2e:eval。ANTHROPIC_API_KEY が必要）
import { test, expect } from "@playwright/test";
import { closeDb, loginAs } from "../helpers";

test.afterAll(closeDb);

test("AC-048: Web UI の質問欄から質問して回答が表示されるまでの時間を20回計測した p50 が 5秒以下", async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY が必要").toBeTruthy();
  const { context, page } = await loginAs(browser, "misaki");
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    await page.goto("/ask");
    await page.getByLabel("質問", { exact: true }).fill("出張の宿泊費の上限はいくら？");
    const t0 = Date.now();
    await page.getByRole("button", { name: "質問する" }).click();
    await expect(page.getByTestId("answer-text")).toBeVisible({ timeout: 60_000 });
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = (times[9] + times[10]) / 2;
  console.log(`AC-048 p50=${p50}ms times=${JSON.stringify(times)}`);
  expect(p50).toBeLessThanOrEqual(5000);
  await context.close();
});
