"use server";
// @covers AC-002, AC-003, AC-133
// @assumption AS-001
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

export type LoginState = { error: string | null };

const LOGIN_FAILED_MESSAGE = "メールアドレスまたはパスワードが違います";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next") as string | null);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: LOGIN_FAILED_MESSAGE };
  redirect(next);
}
