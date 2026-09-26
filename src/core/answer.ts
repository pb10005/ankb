// @covers AC-037, AC-038, AC-039, AC-040, AC-041, AC-042, AC-043, AC-104, AC-105, AC-106, AC-107, AC-108, AC-109, AC-110
// @covers AC-044, AC-111
// @assumption AS-017
// @assumption AS-019
// @assumption AS-046
// @assumption AS-047
// @assumption AS-071
// サーバ合成の ask（指示書 §6.3 方式1）。回答の契約をサーバ側で強制する:
// - すべての主張に根拠ノート（ID・タイトル・チャンク）を付ける。根拠の無い主張・検索結果に無い note_id を引いた主張は捨てる
// - superseded のノートは根拠に使わず、旧情報として区別する
// - conflicts はどちらかに寄せず両論を併記する
// - possibly_outdated のノートを根拠に使ったらその旨を明示する
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchKnowledge, type Conflict, type Hit, type SearchDeps } from "./search";
import { ClaudeSynthesizer, type Claim, type Source, type Synthesizer } from "./synthesizer";

export type Citation = { marker: string; note_id: string; title: string; chunk: string };
export type OutdatedMention = { note_id: string; title: string; note: string };
export type Answer = {
  answer: string;
  citations: Citation[];
  outdated_mentions: OutdatedMention[];
  conflicts: Conflict[];
  not_found: boolean;
  format: "standard" | "timeline";
};

export const NOT_FOUND_TEXT = "関連するノートが見つかりませんでした。";
export const NEAR_INFO_PREFIX = "直接の答えは見つかりませんでした。近い情報:";
export const POSSIBLY_OUTDATED_TEXT = "（更新されている可能性があります）";
export const JUDGEMENT_CHANGED_TEXT = "この時点で判断が変わりました";
export const CURRENT_DECISION_PREFIX = "現在有効な決定:";
const NEAR_INFO_MAX = 3;

export type AskDeps = SearchDeps & { synthesizer?: Synthesizer };

/** 『なぜ』『経緯』『いつから』を含む質問は経緯（timeline）形式で答える（AS-019） */
export const isTimelineQuestion = (q: string) => /なぜ|経緯|いつから/.test(q);

export async function ask(client: SupabaseClient, question: string, deps: AskDeps = {}): Promise<Answer> {
  const format = isTimelineQuestion(question) ? "timeline" : "standard";
  const result = await searchKnowledge(client, question, deps);
  const notFound = (conflicts: Conflict[] = []): Answer => ({
    answer: NOT_FOUND_TEXT,
    citations: [],
    outdated_mentions: [],
    conflicts,
    not_found: true,
    format,
  });
  if (result.hits.length === 0 && result.superseded_context.length === 0) return notFound();

  // ノートごとの代表チャンク（スコア最上位）
  const active = firstPerNote(result.hits);
  const superseded = firstPerNote(result.superseded_context);
  const dates = format === "timeline" ? await noteDates(client, [...active.keys(), ...superseded.keys()]) : new Map<string, string>();

  const sources: Source[] = [
    ...result.hits.map((h) => ({
      note_id: h.note_id,
      title: h.title,
      chunk: h.chunk,
      label: h.possibly_outdated ? ("更新の可能性あり" as const) : ("現行" as const),
      ...(dates.get(h.note_id) ? { date: dates.get(h.note_id) } : {}),
    })),
    ...result.superseded_context.map((h) => ({
      note_id: h.note_id,
      title: h.title,
      chunk: h.chunk,
      label: "旧情報（置き換え済み）" as const,
      ...(dates.get(h.note_id) ? { date: dates.get(h.note_id) } : {}),
    })),
  ];
  const synthesizer = deps.synthesizer ?? new ClaudeSynthesizer();
  const out = await synthesizer.synthesize({
    question,
    timeline: format === "timeline",
    sources,
    conflicts: result.conflicts.map((c) => ({ note_ids: c.note_ids, summary: c.summary })),
  });

  const citations = new Citations(active);
  const outdated = new Map<string, OutdatedMention>();

  // LLM が「見つからない」と答えた: 検索結果の上位を近い情報として併記する（AS-047）
  if (out.not_found) {
    const near = [...active.keys()].slice(0, NEAR_INFO_MAX);
    const mentions = supersededMentions(superseded, new Map());
    if (near.length === 0) return { ...notFound(result.conflicts), outdated_mentions: mentions };
    const items = near.map((id) => `「${active.get(id)!.title}」${citations.marker(id)}`);
    return { answer: `${NEAR_INFO_PREFIX} ${items.join("、")}`, citations: citations.list(), outdated_mentions: mentions, conflicts: result.conflicts, not_found: true, format };
  }

  // 契約の検査: 根拠が無い claim と、検索結果に無い note_id を引いた claim は捨てる（AC-041 / AC-105）
  const allowed = new Set([...active.keys(), ...superseded.keys()]);
  const valid = out.claims.filter((c) => c.note_ids.length > 0 && c.note_ids.every((id) => allowed.has(id)));

  type Rendered = { claim: Claim; activeIds: string[]; outdatedIds: string[]; date: string };
  const rendered: Rendered[] = valid.map((c) => {
    const activeIds = [...new Set(c.note_ids.filter((id) => active.has(id)))];
    const outdatedIds = [...new Set(c.note_ids.filter((id) => superseded.has(id)))];
    const date = [...activeIds, ...outdatedIds].map((id) => dates.get(id) ?? "").sort()[0] ?? "";
    return { claim: c, activeIds, outdatedIds, date };
  });

  const ordered = format === "timeline" ? [...rendered].sort((a, b) => a.date.localeCompare(b.date)) : rendered;
  const paragraphs: string[] = [];
  let lastCurrent: Rendered | undefined;
  for (const r of ordered) {
    // superseded のノートを根拠に含む claim は、現行のノートも併せて引いていても旧情報に降格する（AC-104）。
    // 旧規程の内容が現行の主張として表示されるのを防ぐ（§6.3「superseded のノートは根拠に使わない」）
    if (r.outdatedIds.length > 0) {
      for (const id of r.outdatedIds) outdated.set(id, { note_id: id, title: superseded.get(id)!.title, note: r.claim.text });
      paragraphs.push(`${r.claim.text}（旧情報${format === "timeline" ? `・${JUDGEMENT_CHANGED_TEXT}` : ""}）`);
      continue;
    }
    const po = r.activeIds.some((id) => active.get(id)!.possibly_outdated) ? POSSIBLY_OUTDATED_TEXT : "";
    // LLM が以前の状態として書いた claim（kind=outdated）は根拠を付けたうえで旧情報と明示する
    const label = r.claim.kind === "outdated" ? "（旧情報）" : "";
    paragraphs.push(`${r.claim.text}${label}${po} ${r.activeIds.map((id) => citations.marker(id)).join("")}`);
    if (r.claim.kind !== "outdated") lastCurrent = r;
  }
  // 契約を満たす主張が1件も残らなければ「見つからなかった」と返す（AC-106）。食い違いの併記だけの回答にはしない
  if (!lastCurrent) {
    // 現行の答えは無いが、旧情報として示せる主張は「見つからなかった」に続けて残す
    return {
      ...notFound(result.conflicts),
      answer: [NOT_FOUND_TEXT, ...paragraphs].join("\n\n"),
      citations: citations.list(),
      outdated_mentions: [...outdated.values(), ...supersededMentions(superseded, outdated)],
    };
  }

  // 矛盾はどちらかに寄せず両論を併記する（AC-039 / AC-107）
  for (const c of result.conflicts) {
    const [a, b] = c.note_ids;
    if (!active.has(a) || !active.has(b)) continue;
    paragraphs.push(
      `ただし「${active.get(a)!.title}」${citations.marker(a)}と「${active.get(b)!.title}」${citations.marker(b)}の内容は食い違っています${c.summary ? `（${c.summary}）` : ""}。どちらが正しいかは確認が必要です。`,
    );
  }

  if (format === "timeline" && lastCurrent) {
    paragraphs.push(`${CURRENT_DECISION_PREFIX} ${lastCurrent.claim.text} ${lastCurrent.activeIds.map((id) => citations.marker(id)).join("")}`);
  }

  return {
    answer: paragraphs.join("\n\n"),
    citations: format === "timeline" ? citations.list().sort((x, y) => (dates.get(x.note_id) ?? "").localeCompare(dates.get(y.note_id) ?? "")) : citations.list(),
    outdated_mentions: [...outdated.values(), ...supersededMentions(superseded, outdated)],
    conflicts: result.conflicts,
    not_found: false,
    format,
  };
}

function firstPerNote(hits: Hit[]): Map<string, Hit> {
  const m = new Map<string, Hit>();
  for (const h of hits) if (!m.has(h.note_id)) m.set(h.note_id, h);
  return m;
}

/** superseded_context のノートは、claim に引かれていなくても旧情報として示す（AC-038） */
function supersededMentions(superseded: Map<string, Hit>, already: Map<string, OutdatedMention>): OutdatedMention[] {
  return [...superseded.values()]
    .filter((h) => !already.has(h.note_id))
    .map((h) => ({
      note_id: h.note_id,
      title: h.title,
      note: h.superseded_by ? "新しいノートに置き換えられた旧情報です" : "より新しい版がある可能性があります",
    }));
}

/** 経緯の並び順に使う日付: effective_from、無ければ作成日時（AS-019） */
async function noteDates(client: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await client.from("notes_visible").select("id, effective_from, created_at").in("id", ids);
  return new Map(((data ?? []) as { id: string; effective_from: string | null; created_at: string }[]).map((n) => [n.id, n.effective_from ?? n.created_at.slice(0, 10)]));
}

/** 引用マーカーは answer に現れた順に [1], [2], ... を振る */
class Citations {
  private readonly order: string[] = [];
  constructor(private readonly active: Map<string, Hit>) {}
  marker(noteId: string): string {
    let i = this.order.indexOf(noteId);
    if (i === -1) i = this.order.push(noteId) - 1;
    return `[${i + 1}]`;
  }
  list(): Citation[] {
    return this.order.map((id, i) => {
      const h = this.active.get(id)!;
      return { marker: `[${i + 1}]`, note_id: id, title: h.title, chunk: h.chunk };
    });
  }
}
