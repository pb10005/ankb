// @covers AC-048
// 実 API を使う E2E 計測用。ANKB_TEST_MODE を付けずに起動し、本物の Claude を呼ぶ
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "e2e/eval",
  testIgnore: [],
  use: { ...base.use, baseURL: "http://127.0.0.1:3100" },
  // テスト用の合成器を確実に無効にし、既存サーバ（ANKB_TEST_MODE=1 の dev サーバ）も再利用しない
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ANKB_TEST_MODE: "0" },
  },
});
