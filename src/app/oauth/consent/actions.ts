"use server";
// @covers AC-071
// @assumption AS-024
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function decideAction(form: FormData): Promise<void> {
  const id = String(form.get("authorization_id") ?? "");
  const supabase = await createClient();
  const res =
    String(form.get("decision")) === "approve"
      ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (res.error || !res.data) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&error=1`);
  redirect(res.data.redirect_url);
}
