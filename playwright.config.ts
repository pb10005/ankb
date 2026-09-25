// @covers AC-001, AC-002, AC-003, AC-004, AC-133
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// クラウド開発環境ではプリインストール済みの Chromium を使う（CI は playwright install で取得）
const localChromium = process.env.PW_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
  webServer: {
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
