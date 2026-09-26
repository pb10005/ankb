// @covers AC-133
// ログイン後の遷移先 next パラメータを、同一オリジンの相対パスだけに制限する（open redirect 対策）。
export const DEFAULT_AFTER_LOGIN = "/dashboard";

export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_AFTER_LOGIN;
  // "/" で始まり、"//"（プロトコル相対URL）や "/\"（ブラウザが // と解釈する）で始まらないこと
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;
  // 制御文字を含むものは拒否する（ブラウザがタブ・改行を除去して //evil に化けるのを防ぐ）
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_AFTER_LOGIN;
  return next;
}
