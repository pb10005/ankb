// @covers AC-018, AC-020, AC-026
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** ログイン必須のページ用。未ログインなら /login へ送る */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return { supabase, user };
}
