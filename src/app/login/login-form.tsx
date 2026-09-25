"use client";
// @covers AC-001, AC-002, AC-003
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null });
  return (
    <form action={action} className="stack" aria-label="ログイン">
      <input type="hidden" name="next" value={next} />
      <label>
        メールアドレス
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        パスワード
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        ログイン
      </button>
    </form>
  );
}
