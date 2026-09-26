// @covers AC-001, AC-002, AC-003, AC-004, AC-133, AC-135, AC-136
import { test, expect } from "@playwright/test";
import { MISAKI, fillLogin } from "./fixtures";

test("AC-001: 未ログインで /dashboard を開くと /login へリダイレクトしログインフォームを表示する", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByRole("form", { name: "ログイン" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByLabel("パスワード")).toBeVisible();
});

test("AC-002: 正しい資格情報でログインすると /dashboard へ遷移し美咲のメールアドレスを表示する", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page, MISAKI.email, MISAKI.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("current-user-email")).toHaveText(MISAKI.email);
});

test("AC-003: 誤ったパスワードではエラーを表示し /dashboard へ遷移しない", async ({ page, context }) => {
  await page.goto("/login");
  await fillLogin(page, MISAKI.email, "wrong-password");
  await expect(page.getByRole("form", { name: "ログイン" }).getByRole("alert")).toHaveText("メールアドレスまたはパスワードが違います");
  await expect(page).toHaveURL(/\/login/);
  // セッションが作られていないこと: /dashboard を開くと /login へ戻される
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  const cookies = await context.cookies();
  expect(cookies.filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))).toHaveLength(0);
});

test("AC-004: ログアウト後に /dashboard を開くと /login へリダイレクトする", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page, MISAKI.email, MISAKI.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByRole("form", { name: "ログイン" })).toBeVisible();
});

test("AC-133: next に外部URLを渡してログインしても外部へは遷移せず /dashboard へ遷移する", async ({ page }) => {
  await page.goto("/login?next=https://evil.example/");
  await fillLogin(page, MISAKI.email, MISAKI.password);
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/dashboard$/);
});

test("AC-135: 未ログインで /notes を開いてログインすると /notes へ遷移しノート一覧を表示する", async ({ page }) => {
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/login\?next=%2Fnotes$/);
  await fillLogin(page, MISAKI.email, MISAKI.password);
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("heading", { level: 1, name: "ノート" })).toBeVisible();
});

test("AC-136: ログイン済みで / を開くと /dashboard へ遷移しダッシュボードを表示する", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page, MISAKI.email, MISAKI.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
});
