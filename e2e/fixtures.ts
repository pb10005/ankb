// @covers AC-002, AC-003, AC-004
import type { Page } from "@playwright/test";

// supabase/seed.sql のユーザー（ローカル・CI 専用）
export const MISAKI = { email: "misaki@example.com", password: "ankb-local-password" };

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}
