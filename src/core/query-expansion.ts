// @covers AC-035
// @assumption AS-039
// クエリ展開（言い換え・同義語）。Claude の構造化出力で最大3件の言い換えを得る。
// 失敗・タイムアウト（3秒）・API キー未設定のときは元のクエリだけを返し、検索は止めない（AC-035）。
import Anthropic from "@anthropic-ai/sdk";

export interface QueryExpander {
  expand(query: string): Promise<string[]>;
}

export const EXPANSION_TIMEOUT_MS = 3_000;

const SCHEMA = {
  type: "object",
  properties: {
    paraphrases: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["paraphrases"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "あなたは社内ナレッジベースの検索クエリを言い換える係です。",
  "利用者の質問を、社内文書に書かれていそうな言い回し・同義語・正式名称で最大3通りに言い換えてください。",
  "各言い換えは短い検索語句にし、元の質問に無い事実を足さないでください。",
].join("\n");

export class ClaudeQueryExpander implements QueryExpander {
  private readonly client: Anthropic;
  constructor(
    client?: Anthropic,
    private readonly model = process.env.ANKB_QUERY_EXPANSION_MODEL ?? "claude-opus-5",
  ) {
    this.client = client ?? new Anthropic({ timeout: EXPANSION_TIMEOUT_MS, maxRetries: 0 });
  }

  async expand(query: string): Promise<string[]> {
    try {
      const response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 1024,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: "user", content: query }],
        } as Anthropic.Beta.MessageCreateParamsNonStreaming,
        { timeout: EXPANSION_TIMEOUT_MS, maxRetries: 0 },
      );
      if (response.stop_reason === "refusal") return [query];
      const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
      if (!text) return [query];
      const parsed = JSON.parse(text) as { paraphrases?: unknown };
      const extra = Array.isArray(parsed.paraphrases)
        ? parsed.paraphrases.filter((p): p is string => typeof p === "string" && p.trim() !== "").slice(0, 3)
        : [];
      return dedupe([query, ...extra]);
    } catch {
      return [query];
    }
  }
}

/** API キーが無い環境（開発・CI）では展開しない */
export class NoopQueryExpander implements QueryExpander {
  async expand(query: string): Promise<string[]> {
    return [query];
  }
}

export function defaultQueryExpander(): QueryExpander {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeQueryExpander() : new NoopQueryExpander();
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()))].filter((x) => x !== "");
}
