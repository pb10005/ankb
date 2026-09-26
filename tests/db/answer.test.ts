// @covers AC-037, AC-038, AC-039, AC-040, AC-041, AC-042, AC-043, AC-104, AC-105, AC-106, AC-107, AC-108, AC-109, AC-110, AC-044, AC-111
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asUser, closeAdmin, createNote, relate } from "../helpers/db";
import { indexNote, stubDeps, searchAs } from "../helpers/search";
import { fakeSynthesizer } from "../helpers/fake-anthropic";
import { ask, JUDGEMENT_CHANGED_TEXT, CURRENT_DECISION_PREFIX, NEAR_INFO_PREFIX, POSSIBLY_OUTDATED_TEXT } from "../../src/core/answer";
import { noteId } from "../../src/seed/fixtures";
import { loadScenarios } from "../../src/seed/fixtures";

afterAll(closeAdmin);

const Q = "出張の宿泊費の上限はいくら？";
const NEW = noteId("travel-new");
const OLD = noteId("travel-old");
const MEMO = noteId("travel-memo");
const EXEC = noteId("travel-exec");

async function askAs(user: "misaki" | "kenta", question: string, reply: Parameters<typeof fakeSynthesizer>[0]) {
  const { synthesizer, requests } = fakeSynthesizer(reply);
  const answer = await ask(await asUser(user), question, { ...stubDeps, synthesizer });
  return { answer, requests };
}

const current = (text: string, ...ids: string[]) => ({ text, note_ids: ids, kind: "current" as const });

describe("回答の契約（§6.3）", () => {
  it("AC-037: スタブが改定通知を current で引用すると citations に改定通知の note_id を含む", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW)], not_found: false });
    expect(answer.citations.map((c) => c.note_id)).toContain(NEW);
    expect(answer.not_found).toBe(false);
  });

  it("AC-038: 旧規程は citations に含まれず outdated_mentions に含まれる", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW)], not_found: false });
    expect(answer.citations.map((c) => c.note_id)).not.toContain(OLD);
    expect(answer.outdated_mentions.map((o) => o.note_id)).toContain(OLD);
  });

  it("AC-039: 転記メモと改定通知の食い違いは conflicts に両方の id、citations に両ノートを含む", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW), current("転記メモでは13,000円とされています。", MEMO)], not_found: false });
    const c = answer.conflicts.find((x) => x.note_ids.includes(NEW) && x.note_ids.includes(MEMO));
    expect(c).toBeDefined();
    expect(answer.citations.map((x) => x.note_id)).toEqual(expect.arrayContaining([NEW, MEMO]));
  });

  it("AC-107: スタブが改定通知だけを引用しても answer に両ノートの引用マーカーを含む", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW)], not_found: false });
    const markerOf = (id: string) => answer.citations.find((c) => c.note_id === id)?.marker;
    expect(markerOf(NEW)).toBeDefined();
    expect(markerOf(MEMO)).toBeDefined();
    expect(answer.answer).toContain(markerOf(NEW)!);
    expect(answer.answer).toContain(markerOf(MEMO)!);
  });

  it("AC-040: 美咲が閲覧できない役員向け規程の id・タイトル・本文断片は Answer に含まれない", async () => {
    const exec = loadScenarios()[0].notes.find((n) => n.slug === "travel-exec")!;
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW)], not_found: false });
    const json = JSON.stringify(answer);
    expect(json).not.toContain(EXEC);
    expect(json).not.toContain(exec.title);
    expect(json).not.toContain("25,000円");
  });

  it("AC-108: LLM へのリクエストに役員向け規程の id・タイトル・本文断片が含まれない", async () => {
    const exec = loadScenarios()[0].notes.find((n) => n.slug === "travel-exec")!;
    const { requests } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW)], not_found: false });
    expect(requests).toHaveLength(1);
    const sent = JSON.stringify(requests);
    expect(sent).toContain("宿泊費"); // 実際に資料が渡っている
    expect(sent).not.toContain(EXEC);
    expect(sent).not.toContain(exec.title);
    expect(sent).not.toContain("25,000円");
  });

  it("AC-041: 検索結果に無い note_id を引用した主張は answer にも citations にも含まれない", async () => {
    const fake = randomUUID();
    const { answer } = await askAs("misaki", Q, {
      claims: [current("宿泊費の上限は1泊12,000円です。", NEW), current("捏造された主張です。", fake)],
      not_found: false,
    });
    expect(answer.answer).not.toContain("捏造された主張です。");
    expect(answer.citations.map((c) => c.note_id)).not.toContain(fake);
  });

  it("AC-104: 旧規程を current で引用した主張は citations に入らず outdated_mentions にだけ入る", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊10,000円です。", OLD)], not_found: false });
    expect(answer.citations.map((c) => c.note_id)).not.toContain(OLD);
    expect(answer.outdated_mentions.find((o) => o.note_id === OLD)?.note).toBe("宿泊費の上限は1泊10,000円です。");
  });

  it("AC-105: note_ids が空の主張は answer に含まれない", async () => {
    const { answer } = await askAs("misaki", Q, {
      claims: [current("宿泊費の上限は1泊12,000円です。", NEW), { text: "根拠のない主張です。", note_ids: [], kind: "current" }],
      not_found: false,
    });
    expect(answer.answer).not.toContain("根拠のない主張です。");
  });

  it("AC-106: すべての主張が捨てられると not_found=true で citations は空配列", async () => {
    // 検索で矛盾が出ない質問にする（矛盾の併記だけが残らないように）
    const token = `捨てられる主張${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const id = await createNote({ owner: "misaki", title: `${token} の手順`, body: `${token} の手順です` });
    await indexNote(id);
    const { answer } = await askAs("misaki", token, {
      claims: [{ text: "根拠なし", note_ids: [], kind: "current" }, current("捏造", randomUUID())],
      not_found: false,
    });
    expect(answer.not_found).toBe(true);
    expect(answer.citations).toEqual([]);
  });

  it("AC-042: 該当するノートが1件も無ければ not_found=true で citations は空配列（LLM を呼ばない）", async () => {
    const { answer, requests } = await askAs("misaki", `存在しない話題${randomUUID().replace(/-/g, "")}`, { claims: [], not_found: true });
    expect(answer.not_found).toBe(true);
    expect(answer.citations).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("AC-110: LLM が not_found を返すと、検索結果の上位最大3件を近い情報として citations 付きで返す", async () => {
    const search = await searchAs("misaki", Q);
    const top = [...new Set(search.hits.map((h) => h.note_id))].slice(0, 3);
    const { answer } = await askAs("misaki", Q, { claims: [], not_found: true });
    expect(answer.not_found).toBe(true);
    expect(answer.answer.startsWith(NEAR_INFO_PREFIX)).toBe(true);
    expect(answer.citations.map((c) => c.note_id)).toEqual(top);
    for (const c of answer.citations) expect(answer.answer).toContain(c.marker);
  });

  it("AC-043: possibly_outdated のノートを根拠にした主張の直後に『（更新されている可能性があります）』を含む", async () => {
    const token = `改定予定${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const a = await createNote({ owner: "misaki", title: `${token} 現行`, body: `${token} の規定です` });
    const b = await createNote({ owner: "misaki", title: `${token} 改定案`, body: `${token} の改定案です` });
    await relate(b, a, "supersedes");
    await indexNote(a);
    await indexNote(b);
    const { answer } = await askAs("misaki", token, { claims: [current("現行の規定はこうです。", a)], not_found: false });
    expect(answer.answer).toContain(`現行の規定はこうです。${POSSIBLY_OUTDATED_TEXT}`);
  });

  it("AC-109: answer の [n] と citations の marker が1対1で一致し、title と chunk は検索結果の Hit と等しい", async () => {
    const search = await searchAs("misaki", Q);
    const { answer } = await askAs("misaki", Q, { claims: [current("宿泊費の上限は1泊12,000円です。", NEW), current("メモでは13,000円です。", MEMO)], not_found: false });
    const inText = [...new Set(answer.answer.match(/\[\d+\]/g) ?? [])].sort();
    expect(inText).toEqual(answer.citations.map((c) => c.marker).sort());
    for (const c of answer.citations) {
      const hit = search.hits.find((h) => h.note_id === c.note_id)!;
      expect(c.title).toBe(hit.title);
      expect(c.chunk).toBe(hit.chunk);
      expect(c.title).not.toBe("");
      expect(c.chunk).not.toBe("");
    }
  });
});

describe("経緯の再構成（§6.4）", () => {
  const P = (slug: string) => noteId(slug);
  const timelineReply = {
    claims: [
      { text: "第3回会議でA社に決定した。", note_ids: [P("pay-mtg3")], kind: "timeline" as const },
      { text: "第1回会議ではB社を第一候補とした。", note_ids: [P("pay-mtg1")], kind: "timeline" as const },
      { text: "B社を採用する方針とした。", note_ids: [P("pay-decision-b")], kind: "timeline" as const },
      { text: "B社は定期課金に非対応と判明し判断を見直した。", note_ids: [P("pay-mtg2")], kind: "timeline" as const },
      { text: "決済サービスはA社に決定した。", note_ids: [P("pay-decision-a")], kind: "timeline" as const },
    ],
    not_found: false,
  };

  it("AC-044: citations を日付の昇順で並べ、覆った判断の直後に『この時点で判断が変わりました』、最後の段落に現行の決定のマーカーを含む", async () => {
    const { answer } = await askAs("kenta", "決済サービスをなぜA社にしたんだっけ？", timelineReply);
    expect(answer.format).toBe("timeline");
    const order = answer.citations.map((c) => c.note_id);
    expect(order).toEqual([P("pay-mtg1"), P("pay-mtg2"), P("pay-mtg3"), P("pay-decision-a")]);
    expect(answer.answer).toContain(`B社を採用する方針とした。（旧情報・${JUDGEMENT_CHANGED_TEXT}）`);
    const paragraphs = answer.answer.split("\n\n");
    const last = paragraphs[paragraphs.length - 1];
    const decisionMarker = answer.citations.find((c) => c.note_id === P("pay-decision-a"))!.marker;
    expect(last.startsWith(CURRENT_DECISION_PREFIX)).toBe(true);
    expect(last).toContain(decisionMarker);
    expect(answer.outdated_mentions.map((o) => o.note_id)).toContain(P("pay-decision-b"));
  });

  it("AC-111: 『いつから』を含む質問は timeline 形式、宿泊費の質問は timeline 形式にしない", async () => {
    const t = await askAs("kenta", "決済サービスはいつからA社？", timelineReply);
    expect(t.answer.format).toBe("timeline");
    const firstInput = JSON.stringify(t.requests[0]);
    expect(firstInput).toContain("timeline=true");
    const s = await askAs("misaki", "出張の宿泊費の上限は？", { claims: [current("12,000円です。", NEW)], not_found: false });
    expect(s.answer.format).toBe("standard");
    expect(JSON.stringify(s.requests[0])).toContain("timeline=false");
  });
});

describe("契約の境界", () => {
  it("AC-106: 検索結果に食い違いがあっても、すべての主張が捨てられれば not_found=true で citations は空配列", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [{ text: "根拠なし", note_ids: [], kind: "current" }, current("捏造", randomUUID())], not_found: false });
    expect(answer.conflicts.length).toBeGreaterThan(0); // 前提: 食い違いが検索結果にある
    expect(answer.not_found).toBe(true);
    expect(answer.citations).toEqual([]);
  });

  it("AC-104: 現行と旧規程を併せて引いた主張も旧情報に降格し、現行の主張として表示しない", async () => {
    const { answer } = await askAs("misaki", Q, {
      claims: [current("宿泊費の上限は1泊12,000円です。", NEW), current("上限は10,000円です。", NEW, OLD)],
      not_found: false,
    });
    expect(answer.answer).toContain("上限は10,000円です。（旧情報）");
    const para = answer.answer.split("\n\n").find((p) => p.includes("上限は10,000円です。"))!;
    expect(para).not.toMatch(/\[\d+\]/);
    expect(answer.citations.map((c) => c.note_id)).not.toContain(OLD);
  });

  it("AS-071: LLM が not_found を返しても superseded_context のノートは outdated_mentions に入る", async () => {
    const { answer } = await askAs("misaki", Q, { claims: [], not_found: true });
    expect(answer.outdated_mentions.map((o) => o.note_id)).toContain(OLD);
  });
});

describe("LLM の失敗", () => {
  it("AC-045: タイムアウトや5xx（SDK の例外）は UpstreamError に変換され、部分的な Answer を返さない", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { UpstreamError } = await import("../../src/core/synthesizer");
    for (const err of [new Anthropic.APIConnectionTimeoutError(), new Anthropic.InternalServerError(500, undefined, "boom", new Headers())]) {
      const { synthesizer } = fakeSynthesizer(err);
      await expect(ask(await asUser("misaki"), Q, { ...stubDeps, synthesizer })).rejects.toBeInstanceOf(UpstreamError);
    }
  });
});
