// @covers AC-049, AC-054, AC-059, AC-116
// @assumption AS-044
// @assumption AS-077
// 候補ノートの組を LLM で判定する（指示書 §6.2 推定 3）。supersedes / contradicts / related / none と確信度・理由を返す。
import Anthropic from "@anthropic-ai/sdk";
import { isCi } from "../core/test-synthesizers";

export type NoteText = { id: string; title: string; body: string; effective_from: string | null; updated_at: string };
export type Judgement = {
  type: "supersedes" | "contradicts" | "related" | "none";
  /** supersedes の向き。target=保存されたノート、candidate=既存ノート */
  direction: "target_supersedes_candidate" | "candidate_supersedes_target";
  confidence: number;
  rationale: string;
};
export interface Judge {
  judge(target: NoteText, candidate: NoteText): Promise<Judgement>;
}

const SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["supersedes", "contradicts", "related", "none"] },
    direction: { type: "string", enum: ["target_supersedes_candidate", "candidate_supersedes_target"] },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["type", "direction", "confidence", "rationale"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "あなたは社内ナレッジベースで、2つのノートの関係を判定する係です。",
  "- supersedes: 一方が他方の内容を新しく置き換えている（改定・新版・覆った決定）。direction で向きを示す",
  "- contradicts: どちらも現行のつもりで書かれているが内容が食い違っている",
  "- related: 同じテーマだが置き換えも食い違いも無い",
  "- none: 関係が無い",
  "confidence は 0〜1 の確信度。rationale は人間が読む日本語で1〜2文。ノートに書かれていないことを推測しない。",
].join("\n");

const render = (label: string, n: NoteText) =>
  `<note role="${label}" effective_from="${n.effective_from ?? ""}" updated_at="${n.updated_at}">\n# ${n.title}\n${n.body.slice(0, 6000)}\n</note>`;

export class ClaudeJudge implements Judge {
  private readonly client: Pick<Anthropic, "beta">;
  constructor(client?: Pick<Anthropic, "beta">, private readonly model = process.env.ANKB_RELATION_MODEL ?? "claude-opus-5") {
    this.client = client ?? new Anthropic({ timeout: 60_000, maxRetries: 0 });
  }
  async judge(target: NoteText, candidate: NoteText): Promise<Judgement> {
    const res = (await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `${render("target", target)}\n${render("candidate", candidate)}` }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)) as Anthropic.Beta.BetaMessage;
    if (res.stop_reason === "refusal") return { type: "none", direction: "target_supersedes_candidate", confidence: 0, rationale: "" };
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!text) throw new Error("empty judgement");
    const j = JSON.parse(text) as Judgement;
    if (!["supersedes", "contradicts", "related", "none"].includes(j.type) || typeof j.confidence !== "number") throw new Error("schema mismatch");
    return j;
  }
}

/**
 * E2E 用の決定的な判定（ANKB_TEST_MODE=1 かつ開発サーバか CI のときだけ: AS-077）。
 * タイトル末尾の識別子（最後の空白以降）が同じ組のうち、「新・」と「旧・」→ supersedes、両方に「矛盾」→ contradicts、それ以外は none
 */
export class TitleRuleJudge implements Judge {
  async judge(target: NoteText, candidate: NoteText): Promise<Judgement> {
    const suffix = (t: string) => t.trim().split(/\s+/).pop();
    if (suffix(target.title) !== suffix(candidate.title)) {
      return { type: "none", direction: "target_supersedes_candidate", confidence: 0, rationale: "" };
    }
    if (target.title.includes("新・") && candidate.title.includes("旧・")) {
      return { type: "supersedes", direction: "target_supersedes_candidate", confidence: 0.9, rationale: "新しい版で内容が改定されているため" };
    }
    if (target.title.includes("矛盾") && candidate.title.includes("矛盾")) {
      return { type: "contradicts", direction: "target_supersedes_candidate", confidence: 0.8, rationale: "金額の記載が食い違っているため" };
    }
    return { type: "none", direction: "target_supersedes_candidate", confidence: 0, rationale: "" };
  }
}

export function defaultJudge(): Judge {
  const testMode = process.env.ANKB_TEST_MODE === "1" && (process.env.NODE_ENV !== "production" || isCi());
  return testMode ? new TitleRuleJudge() : new ClaudeJudge();
}
