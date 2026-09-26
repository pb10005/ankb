// @covers AC-048
// 実 API を使う E2E 計測用。ANKB_TEST_MODE を付けずに起動し、本物の Claude を呼ぶ
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "e2e/eval",
  testIgnore: [],
  webServer: { ...(base.webServer as object), env: {} } as typeof base.webServer,
});
