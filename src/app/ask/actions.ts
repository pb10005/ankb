"use server";
// @covers AC-045, AC-046
import { cookies } from "next/headers";
import { ask, type Answer } from "@/core/answer";
import { UpstreamError } from "@/core/synthesizer";
import { testSynthesizer } from "@/core/test-synthesizers";
import { createClient } from "@/lib/supabase/server";
import { consumeAskQuota } from "@/core/usage";

export type AskState = { question: string; answer: Answer | null; error: string | null };

const UPSTREAM_ERROR_MESSAGE = "回答を作成できませんでした。時間をおいて再度お試しください";

export async function askAction(_prev: AskState, form: FormData): Promise<AskState> {
  const question = String(form.get("question") ?? "").trim();
  if (question === "") return { question, answer: null, error: "質問を入力してください" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { question, answer: null, error: "ログインが必要です" };
  if (!(await consumeAskQuota(supabase))) return { question, answer: null, error: "質問の回数の上限に達しました。時間をおいてから質問してください" };
  try {
    const synthesizer = testSynthesizer((await cookies()).get("ankb-test-synth")?.value);
    const answer = await ask(supabase, question, synthesizer ? { synthesizer } : {});
    return { question, answer, error: null };
  } catch (e) {
    // 部分的な回答は表示しない（AC-045）
    if (e instanceof UpstreamError) return { question, answer: null, error: UPSTREAM_ERROR_MESSAGE };
    console.error("[ankb] ask failed:", e);
    return { question, answer: null, error: UPSTREAM_ERROR_MESSAGE };
  }
}
