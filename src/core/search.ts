// @covers AC-027, AC-028, AC-029, AC-030, AC-031, AC-032, AC-033, AC-034, AC-035, AC-036, AC-102, AC-103
// @assumption AS-013
// @assumption AS-014
// @assumption AS-015
// @assumption AS-037
// @assumption AS-039
// @assumption AS-070
// 検索パイプライン（指示書 §6.1）。Web UI・サーバMCP・WebMCP のすべてがこの関数を通す。
//   質問 → クエリ展開 → ハイブリッド検索（全文 + ベクトル、RLS 下）→ resolveCurrent() → 再ランキング → SearchResult
// client は質問者のセッションで作った Supabase クライアント。サービスロールは使わない（§5.2-2）。
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultEmbedder, toPgVector, type Embedder } from "./embedding";
import { defaultQueryExpander, type QueryExpander } from "./query-expansion";

export type Hit = {
  note_id: string;
  title: string;
  chunk: string;
  status: "active" | "superseded";
  updated_at: string;
  effective_from?: string;
  possibly_outdated: boolean;
  superseded_by?: string;
  score: number;
};

export type Conflict = { note_ids: string[]; summary: string; relation_state: "proposed" | "confirmed" };

export type SearchResult = {
  hits: Hit[];
  superseded_context: Hit[];
  conflicts: Conflict[];
  synthesis_guidelines: string;
};

/** 回答の契約（指示書 §6.3）の要約。クライアント側で合成するエージェントに渡す */
export const SYNTHESIS_GUIDELINES = [
  "回答の契約:",
  "1. すべての主張に根拠ノート（note_id とタイトル）を付ける。hits に無い情報を根拠にしない。",
  "2. 根拠が見つからない場合は推測で答えず「見つからなかった」と答え、近い情報があれば併記する。",
  "3. superseded_context のノートは現行の根拠に使わない。関連する場合は「以前は〜だった（旧情報）」と区別する。superseded_by が無いものは「より新しい版がある可能性」とだけ伝える。",
  "4. conflicts がある場合は、どちらかに寄せずに両論と各根拠を示す。",
  "5. possibly_outdated=true のノートを根拠に使う場合は「更新されている可能性がある」と明示する。",
].join("\n");

export const RRF_K = 60;
export const MAX_HITS = 10;
export const MAX_SUPERSEDED = 5;
const RETRIEVE_LIMIT = 50;
/** ベクトル検索で拾うコサイン類似度の下限（AS-070）。近傍検索は無関係なチャンクも必ず返すため */
export const VECTOR_MIN_SIMILARITY = Number(process.env.ANKB_VECTOR_MIN_SIMILARITY ?? 0.3);

export type SearchDeps = { embedder?: Embedder; expander?: QueryExpander };

type ChunkRow = { chunk_id: string; note_id: string; content: string; score: number };
type NoteMeta = {
  id: string;
  title: string;
  status: "draft" | "active" | "superseded" | "archived";
  owner_id: string;
  superseded_by: string | null;
  effective_from: string | null;
  updated_at: string;
};
type RelationRow = { from_note_id: string; to_note_id: string; type: string; state: "proposed" | "confirmed"; rationale: string };

/** 各語をフレーズとして引用した PGroonga のクエリ（空白区切りは AND。OR などの演算子もリテラル扱い） */
export function toPgroongaQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter((w) => w !== "")
    .map((w) => `"${w.replace(/["\\]/g, (c) => `\\${c}`)}"`)
    .join(" ");
}

export async function searchKnowledge(client: SupabaseClient, query: string, deps: SearchDeps = {}): Promise<SearchResult> {
  const q = query.trim();
  const empty: SearchResult = { hits: [], superseded_context: [], conflicts: [], synthesis_guidelines: SYNTHESIS_GUIDELINES };
  if (q === "") return empty;

  const embedder = deps.embedder ?? defaultEmbedder();
  const expander = deps.expander ?? defaultQueryExpander();
  const variants = await expander.expand(q).catch(() => [q]);

  // ハイブリッド検索: 各言い換え × (全文, ベクトル) のランキングを Reciprocal Rank Fusion で統合する
  const rankings: ChunkRow[][] = [];
  let vectors: number[][] = [];
  try {
    vectors = await embedder.embed(variants, "query");
  } catch {
    vectors = []; // embedding が使えなくても全文検索だけで続ける
  }
  await Promise.all(
    variants.map(async (v, i) => {
      const fts = await client.rpc("search_chunks_fts", { p_query: toPgroongaQuery(v), p_limit: RETRIEVE_LIMIT });
      if (!fts.error && fts.data) rankings.push(fts.data as ChunkRow[]);
      if (vectors[i]) {
        const vec = await client.rpc("search_chunks_vector", {
          p_embedding: toPgVector(vectors[i]),
          p_limit: RETRIEVE_LIMIT,
          p_min_similarity: VECTOR_MIN_SIMILARITY,
        });
        if (!vec.error && vec.data) rankings.push(vec.data as ChunkRow[]);
      }
    }),
  );

  const fused = new Map<string, { row: ChunkRow; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((row, rank) => {
      const cur = fused.get(row.chunk_id) ?? { row, score: 0 };
      cur.score += 1 / (RRF_K + rank + 1);
      fused.set(row.chunk_id, cur);
    });
  }
  if (fused.size === 0) return empty;

  const noteIds = [...new Set([...fused.values()].map((f) => f.row.note_id))];
  const [{ data: notes }, { data: relations }] = await Promise.all([
    client
      .from("notes_visible")
      .select("id, title, status, owner_id, superseded_by, effective_from, updated_at")
      .in("id", noteIds),
    // note_relation は RLS により両端を閲覧できる関係だけが返る（AS-037）
    client
      .from("note_relation")
      .select("from_note_id, to_note_id, type, state, rationale")
      .in("state", ["proposed", "confirmed"])
      .or(`from_note_id.in.(${noteIds.join(",")}),to_note_id.in.(${noteIds.join(",")})`),
  ]);
  const meta = new Map((notes as NoteMeta[] | null ?? []).map((n) => [n.id, n]));
  return resolveCurrent([...fused.values()], meta, (relations as RelationRow[] | null) ?? []);
}

/**
 * 有効性の解決（指示書 §6.1 resolveCurrent）
 * - superseded のノートは本流から外し superseded_context へ（置き換え先を閲覧できなければ superseded_by を付けない）
 * - proposed の supersedes の置き換え対象には possibly_outdated=true
 * - active なノートに contradicts（proposed / confirmed）があれば conflicts に入れる
 */
export function resolveCurrent(
  fused: { row: ChunkRow; score: number }[],
  meta: Map<string, NoteMeta>,
  relations: RelationRow[],
): SearchResult {
  const possiblyOutdated = new Set(
    relations.filter((r) => r.type === "supersedes" && r.state === "proposed").map((r) => r.to_note_id),
  );

  const toHit = (row: ChunkRow, score: number, n: NoteMeta): Hit => ({
    note_id: n.id,
    title: n.title,
    chunk: row.content,
    status: n.status === "superseded" ? "superseded" : "active",
    updated_at: n.updated_at,
    ...(n.effective_from ? { effective_from: n.effective_from } : {}),
    possibly_outdated: n.status !== "superseded" && possiblyOutdated.has(n.id),
    ...(n.status === "superseded" && n.superseded_by ? { superseded_by: n.superseded_by } : {}),
    score,
  });

  // 再ランキング: RRF スコア順。同点なら効力発生日・更新日が新しいもの（AS-013）
  const newer = (h: Hit) => `${h.effective_from ?? ""}|${h.updated_at}`;
  const order = (a: Hit, b: Hit) => b.score - a.score || newer(b).localeCompare(newer(a)) || a.note_id.localeCompare(b.note_id);

  const hits: Hit[] = [];
  const superseded: Hit[] = [];
  for (const { row, score } of fused) {
    const n = meta.get(row.note_id);
    if (!n || n.status === "archived") continue; // RLS で見えない・アーカイブ済み
    const hit = toHit(row, score, n);
    (n.status === "superseded" ? superseded : hits).push(hit);
  }
  hits.sort(order);
  superseded.sort(order);
  const topHits = hits.slice(0, MAX_HITS);

  const activeIds = new Set(topHits.map((h) => h.note_id));
  const seen = new Set<string>();
  const conflicts: Conflict[] = [];
  for (const r of relations) {
    if (r.type !== "contradicts" || !(activeIds.has(r.from_note_id) || activeIds.has(r.to_note_id))) continue;
    const key = [r.from_note_id, r.to_note_id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ note_ids: [r.from_note_id, r.to_note_id], summary: r.rationale, relation_state: r.state });
  }

  return { hits: topHits, superseded_context: superseded.slice(0, MAX_SUPERSEDED), conflicts, synthesis_guidelines: SYNTHESIS_GUIDELINES };
}
