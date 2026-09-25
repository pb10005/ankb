// @covers AC-027, AC-033, AC-034, AC-036
// @assumption AS-068
// 埋め込みベクトルの生成。VOYAGE_API_KEY があれば Voyage AI の多言語モデル（AS-058）、無ければ決定的なスタブを使う。
// スタブは文字バイグラムのハッシュで作るベクトルで、開発とテスト専用（意味検索の品質は無い）。
import { createHash } from "node:crypto";

export const EMBEDDING_DIM = 1024;

export interface Embedder {
  readonly name: string;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

export class StubEmbedder implements Embedder {
  readonly name = "stub";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(EMBEDDING_DIM).fill(0);
      const chars = [...t.toLowerCase().replace(/\s+/g, "")];
      for (let i = 0; i < chars.length - 1; i++) {
        const h = createHash("md5").update(chars[i] + chars[i + 1]).digest();
        v[h.readUInt16BE(0) % EMBEDDING_DIM] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

export class VoyageEmbedder implements Embedder {
  readonly name: string;
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.ANKB_EMBEDDING_MODEL ?? "voyage-3.5",
    private readonly timeoutMs = 10_000,
  ) {
    this.name = `voyage:${model}`;
  }

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: this.model, input_type: kind, output_dimension: EMBEDDING_DIM }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Voyage AI embeddings: HTTP ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export function defaultEmbedder(): Embedder {
  const key = process.env.VOYAGE_API_KEY;
  return key ? new VoyageEmbedder(key) : new StubEmbedder();
}

export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
