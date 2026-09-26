// @covers AC-047
// 実 Claude API による回答の契約の評価（npm run test:eval。ANTHROPIC_API_KEY が必要）。
// UC1・UC2 の質問を各10回 ask し、旧情報を現行として扱った件数を数える。
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closeAdmin } from "../helpers/db";
import { stubDeps } from "../helpers/search";
import { ask } from "../../src/core/answer";
import { ClaudeSynthesizer, type SynthesisInput, type SynthesisOutput, type Synthesizer } from "../../src/core/synthesizer";
import { noteId } from "../../src/seed/fixtures";

afterAll(closeAdmin);

/** 本物の合成器の出力（claims）を記録するラッパ */
class Recording implements Synthesizer {
  outputs: { input: SynthesisInput; output: SynthesisOutput }[] = [];
  constructor(private readonly inner: Synthesizer) {}
  async synthesize(input: SynthesisInput) {
    const output = await this.inner.synthesize(input);
    this.outputs.push({ input, output });
    return output;
  }
}

const CASES = [
  { user: "misaki" as const, question: "出張の宿泊費の上限はいくら？", superseded: [noteId("travel-old")], oldAmounts: ["10,000円"] },
  { user: "kenta" as const, question: "決済サービスをなぜA社にしたんだっけ？", superseded: [noteId("pay-decision-b")], oldAmounts: [] as string[] },
];

describe("回答の契約の評価（実 Claude API）", () => {
  it("AC-047: UC1・UC2 の各質問を10回 ask して、旧情報を現行として回答した件数が0件と記録される", async () => {
    expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY が必要").toBeTruthy();
    let violations = 0;
    const log: string[] = [];
    for (const c of CASES) {
      for (let i = 0; i < 10; i++) {
        const rec = new Recording(new ClaudeSynthesizer());
        const answer = await ask(await asUser(c.user), c.question, { ...stubDeps, synthesizer: rec });
        const claims = rec.outputs.flatMap((o) => o.output.claims);
        // kind=current で superseded ノートを引用した claim
        const bad = claims.filter((cl) => cl.kind === "current" && cl.note_ids.some((id) => c.superseded.includes(id)));
        // outdated_mentions 以外（= answer 本文の、旧情報と明示していない文）で旧規程の金額を含む文
        const sentences = answer.answer.split(/\n\n|。/).filter((s) => !s.includes("旧情報"));
        const leaked = sentences.filter((s) => c.oldAmounts.some((a) => s.includes(a)));
        violations += bad.length + leaked.length;
        log.push(`${c.question} #${i + 1}: current引用=${bad.length} 金額漏れ=${leaked.length}`);
      }
    }
    console.log(`AC-047 violations=${violations}\n${log.join("\n")}`);
    expect(violations).toBe(0);
  }, 30 * 60_000);
});
