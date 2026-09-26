// @covers AC-045, AC-046
// @assumption AS-072
// E2E テスト用の決定的な合成器。ANKB_TEST_MODE=1 のときだけ使われる（本番では選ばれない）。
import { UpstreamError, type SynthesisInput, type SynthesisOutput, type Synthesizer } from "./synthesizer";

/** 各資料の本文1行目を主張として返す。旧情報は outdated、それ以外は current */
export class EchoSynthesizer implements Synthesizer {
  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    const seen = new Set<string>();
    const claims = input.sources
      .filter((s) => (seen.has(s.note_id) ? false : (seen.add(s.note_id), true)))
      .map((s) => {
        const line = s.chunk.split("\n").find((l) => l.trim() !== "" && !l.startsWith("#")) ?? s.title;
        return { text: line.trim(), note_ids: [s.note_id], kind: s.label.startsWith("旧情報") ? ("outdated" as const) : ("current" as const) };
      });
    return { claims, not_found: claims.length === 0 };
  }
}

export class FailingSynthesizer implements Synthesizer {
  async synthesize(): Promise<SynthesisOutput> {
    throw new UpstreamError("test: upstream failure");
  }
}

export function testSynthesizer(mode: string | undefined): Synthesizer | undefined {
  // 二重の防御: ANKB_TEST_MODE=1 に加え、開発サーバか CI のときだけ有効にする（本番に誤って設定されても無効）
  if (process.env.ANKB_TEST_MODE !== "1") return undefined;
  if (process.env.NODE_ENV === "production" && !process.env.CI) return undefined;
  return mode === "fail" ? new FailingSynthesizer() : new EchoSynthesizer();
}
