"use server";
// @covers AC-050, AC-051, AC-056, AC-116
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveProposal } from "@/core/relations";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

export async function resolveAction(form: FormData): Promise<void> {
  const supabase = await createClient();
  const decision = String(form.get("decision")) === "confirm" ? "confirm" : "reject";
  await resolveProposal(supabase, String(form.get("relation_id")), decision);
  revalidatePath("/", "layout");
  redirect(safeNextPath(String(form.get("back") ?? "/inbox")));
}

/** インボックスの一括処理 */
export async function resolveManyAction(form: FormData): Promise<void> {
  const supabase = await createClient();
  const decision = String(form.get("decision")) === "confirm" ? "confirm" : "reject";
  for (const id of form.getAll("relation_id")) await resolveProposal(supabase, String(id), decision);
  revalidatePath("/", "layout");
  redirect("/inbox");
}
