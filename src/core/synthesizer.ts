// @covers AC-037, AC-041, AC-045, AC-108, AC-110, AC-119
// @assumption AS-017
// @assumption AS-046
// @assumption AS-048
// 回答の合成に使う LLM 呼び出し。Claude に構造化出力で claims を出させ、文章の組み立ては answer.ts がサーバ側で行う。
// LLM に渡すのは searchKnowledge の結果（質問者の RLS 下で得たチャンク）だけ（§5.2-3 / AS-046）。
import Anthropic from "@anthropic-ai/sdk";

export type ClaimKind = "current" | "outdated" | "conflict" | "timeline";
export type Claim = { text: string; note_ids: string[]; kind: ClaimKind; date?: string };
export type SynthesisOutput = { claims: Claim[]; not_found: boolean };

export type Source = {
  note_id: string;
  title: string;
  chunk: string;
  label: "現行" | "旧情報（置き換え済み）" | "更新の可能性あり";
  date?: string;
};
export type SynthesisInput = { question: string; timeline: boolean; sources: Source[]; conflicts: { note_ids: string[]; summary: string }[] };

export interface Synthesizer {
  synthesize(input: SynthesisInput): Promise<SynthesisOutput>;
}

/** LLM が失敗した（タイムアウト・5xx・拒否・スキーマ違反） */
export class UpstreamError extends Error {
  readonly code = "UPSTREAM_ERROR";
}

export const ANSWER_TIMEOUT_MS = 30_000;

const SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          note_ids: { type: "array", items: { type: "string" } },
          kind: { type: "string", enum: ["current", "outdated", "conflict", "timeline"] },
          date: { type: "string" },
        },
        required: ["text", "note_ids", "kind"],
        additionalProperties: false,
      },
    },
    not_found: { type: "boolean" },
  },
  required: ["claims", "not_found"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "あなたは社内ナレッジベース ankb の回答作成係です。与えられた資料（sources）だけを根拠に、質問への回答を主張（claims）の配列として返します。",
  "規則:",
  "- 各 claim は1つの主張を日本語の1〜2文で書き、根拠にした資料の note_id を note_ids に必ず入れる。資料に無い note_id を書かない。",
  "- 資料から答えが分からない場合は推測せず not_found を true にし、claims は空にする。",
  "- 『旧情報（置き換え済み）』の資料は現行の答えの根拠にしない。触れる場合は kind=outdated とし「以前は〜だった」と書く。",
  "- 資料どうしが食い違っている場合は、どちらかに寄せず両方の主張を書く。",
  "- timeline=true の質問では、経緯を段階ごとの claim に分け kind=timeline とし、date に資料の日付を入れる。",
  "- 引用マーカーや資料番号は text に書かない（サーバが付ける）。",
].join("\n");

function renderSources(input: SynthesisInput): string {
  const lines = input.sources.map(
    (s) => `<source note_id="${s.note_id}" status="${s.label}"${s.date ? ` date="${s.date}"` : ""}>\n# ${s.title}\n${s.chunk}\n</source>`,
  );
  const conflicts = input.conflicts.map((c) => `- ${c.note_ids.join(" と ")} は食い違っている: ${c.summary}`);
  return [
    `timeline=${input.timeline}`,
    "<sources>",
    ...lines,
    "</sources>",
    conflicts.length ? `<conflicts>\n${conflicts.join("\n")}\n</conflicts>` : "",
    `質問: ${input.question}`,
  ]
    .filter(Boolean)
    .join("\n");
}

type MessagesClient = Pick<Anthropic, "beta">;

export class ClaudeSynthesizer implements Synthesizer {
  private readonly client: MessagesClient;
  constructor(
    client?: MessagesClient,
    private readonly model = process.env.ANKB_ANSWER_MODEL ?? "claude-opus-5",
  ) {
    this.client = client ?? new Anthropic({ timeout: ANSWER_TIMEOUT_MS, maxRetries: 1 });
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = (await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: "user", content: renderSources(input) }],
        } as Anthropic.Beta.MessageCreateParamsNonStreaming,
        { timeout: ANSWER_TIMEOUT_MS, maxRetries: 1 },
      )) as Anthropic.Beta.BetaMessage;
    } catch (e) {
      throw new UpstreamError(e instanceof Error ? e.message : String(e));
    }
    if (response.stop_reason === "refusal") throw new UpstreamError("refusal");
    if (response.stop_reason === "max_tokens") throw new UpstreamError("max_tokens");
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!text) throw new UpstreamError("empty response");
    return parseOutput(text);
  }
}

/** 構造化出力のスキーマ検査。合わなければ失敗として扱う（AS-048） */
export function parseOutput(text: string): SynthesisOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UpstreamError("invalid json");
  }
  const o = raw as { claims?: unknown; not_found?: unknown };
  if (!Array.isArray(o.claims) || typeof o.not_found !== "boolean") throw new UpstreamError("schema mismatch");
  const claims: Claim[] = [];
  for (const c of o.claims as Record<string, unknown>[]) {
    if (typeof c?.text !== "string" || !Array.isArray(c.note_ids) || !["current", "outdated", "conflict", "timeline"].includes(c.kind as string)) {
      throw new UpstreamError("schema mismatch");
    }
    claims.push({
      text: c.text,
      note_ids: (c.note_ids as unknown[]).filter((x): x is string => typeof x === "string"),
      kind: c.kind as ClaimKind,
      ...(typeof c.date === "string" ? { date: c.date } : {}),
    });
  }
  return { claims, not_found: o.not_found };
}
