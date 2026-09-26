// @covers AC-027, AC-028, AC-029, AC-030, AC-031, AC-032, AC-033, AC-035, AC-036, AC-100, AC-102, AC-103
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, asUser, closeAdmin, createNote, relate, share, type UserName } from "../helpers/db";
import { expectedVisibility, indexNote, noteIds, searchAs, stubDeps } from "../helpers/search";
import { noteId } from "../../src/seed/fixtures";
import { seed } from "../../src/seed/seed";
import { loadTestEnv } from "../helpers/env";
import { toPgroongaQuery } from "../../src/core/search";
import type { QueryExpander } from "../../src/core/query-expansion";

afterAll(closeAdmin);

// テスト間の識別子。時刻を使うと近い時刻のトークンが長い共通部分を持ち、スタブ embedding（文字バイグラム）で
// 別テストのノートが類似度の下限を超えて混ざるので、乱数だけで作る
const uniq = (label: string) => `${label}${randomUUID().replace(/-/g, "").slice(0, 16)}`;

describe("resolveCurrent（§6.1）", () => {
  it("AC-027: 出張規程シナリオで旧規程は hits に含まれず superseded_context に改定通知の id 付きで返る", async () => {
    const r = await searchAs("misaki", "出張の宿泊費の上限");
    expect(noteIds(r.hits)).not.toContain(noteId("travel-old"));
    const old = r.superseded_context.find((h) => h.note_id === noteId("travel-old"));
    expect(old).toBeDefined();
    expect(old!.status).toBe("superseded");
    expect(old!.superseded_by).toBe(noteId("travel-new"));
    expect(noteIds(r.hits)).toContain(noteId("travel-new"));
  });

  it("AC-028: 置き換え先を閲覧できない superseded ノートは superseded_by 無しで返り、置き換え先の id・タイトルを含まない", async () => {
    const token = uniq("旧版検証");
    const a = await createNote({ owner: "misaki", visibility: "workspace", title: `${token} の手順`, body: `${token} を使う手順` });
    const bTitle = `${uniq("非公開の新版")}`;
    const b = await createNote({ owner: "kenta", visibility: "private", title: bTitle, body: `${token} の新しい手順` });
    await relate(b, a, "supersedes", "confirmed", "kenta");
    await indexNote(a);
    await indexNote(b);
    const r = await searchAs("misaki", token);
    const hit = r.superseded_context.find((h) => h.note_id === a);
    expect(hit).toBeDefined();
    expect(hit).not.toHaveProperty("superseded_by");
    const json = JSON.stringify(r);
    expect(json).not.toContain(b);
    expect(json).not.toContain(bTitle);
  });

  it("AC-029: contradicts（proposed）で結ばれた active なノート2件は conflicts に両方の id と relation_state=proposed で返る", async () => {
    const token = uniq("矛盾検証");
    const a = await createNote({ owner: "misaki", title: `${token} A`, body: `${token} の上限は1万円` });
    const b = await createNote({ owner: "kenta", title: `${token} B`, body: `${token} の上限は2万円` });
    await relate(a, b, "contradicts");
    await indexNote(a);
    await indexNote(b);
    const r = await searchAs("misaki", token);
    const c = r.conflicts.find((x) => x.note_ids.includes(a) && x.note_ids.includes(b));
    expect(c).toBeDefined();
    expect(c!.relation_state).toBe("proposed");
  });

  it("AC-030: proposed な supersedes の置き換え対象の hit は possibly_outdated=true", async () => {
    const token = uniq("更新候補");
    const a = await createNote({ owner: "misaki", title: `${token} 現行`, body: `${token} の規定` });
    const b = await createNote({ owner: "misaki", title: `${token} 改定案`, body: `${token} の改定案` });
    await relate(b, a, "supersedes");
    await indexNote(a);
    await indexNote(b);
    const r = await searchAs("misaki", token);
    expect(r.hits.find((h) => h.note_id === a)?.possibly_outdated).toBe(true);
    expect(r.hits.find((h) => h.note_id === b)?.possibly_outdated).toBe(false);
  });

  it("AC-102: 見えないノートとの contradicts と proposed supersedes では conflicts は空で possibly_outdated=false", async () => {
    const token = uniq("非公開相手");
    const a = await createNote({ owner: "misaki", visibility: "workspace", title: `${token} 公開`, body: `${token} の内容` });
    const b = await createNote({ owner: "kenta", visibility: "private", title: `${token} 非公開`, body: `${token} の別内容` });
    await relate(a, b, "contradicts");
    await relate(b, a, "supersedes");
    await indexNote(a);
    await indexNote(b);
    const r = await searchAs("misaki", token);
    expect(r.hits.find((h) => h.note_id === a)?.possibly_outdated).toBe(false);
    expect(r.conflicts).toEqual([]);
  });
});

describe("下書きと権限", () => {
  it("AC-031: 美咲の検索結果に美咲自身の draft は含まれ、健太の workspace 公開の draft は含まれない", async () => {
    const token = uniq("下書き検証");
    const mine = await createNote({ owner: "misaki", status: "draft", visibility: "private", title: `${token} 美咲`, body: token });
    const his = await createNote({ owner: "kenta", status: "draft", visibility: "workspace", title: `${token} 健太`, body: token });
    await indexNote(mine);
    await indexNote(his);
    const r = await searchAs("misaki", token);
    const ids = [...noteIds(r.hits), ...noteIds(r.superseded_context)];
    expect(ids).toContain(mine);
    expect(ids).not.toContain(his);
  });

  it("AC-032: 各ユーザーの検索結果の文字列に、閲覧できないノートの id・title・本文断片が含まれない", async () => {
    for (const user of ["misaki", "kenta", "sho", "yuki", "outsider"] as UserName[]) {
      const { invisible } = expectedVisibility(user);
      for (const query of ["合言葉", "宿泊費の上限", "決済サービス"]) {
        const json = JSON.stringify(await searchAs(user, query));
        for (const n of invisible) {
          expect(json, `${user}/${query}`).not.toContain(n.id);
          expect(json, `${user}/${query}`).not.toContain(n.title);
          // 本文の特徴的な断片（合言葉・金額など）
          for (const frag of n.body.match(/合言葉は[^。]+|[0-9,]+円/g) ?? []) expect(json, `${user}/${query}/${frag}`).not.toContain(frag);
        }
      }
    }
  });

  it("AC-100: 健太のJWTで検索用RPCを直接呼んでも、健太が閲覧できないノートのチャンクは0件", async () => {
    const kenta = await asUser("kenta");
    const { invisible } = expectedVisibility("kenta");
    const invisibleIds = new Set(invisible.map((n) => n.id));
    const fts = await kenta.rpc("search_chunks_fts", { p_query: toPgroongaQuery("合言葉"), p_limit: 200 });
    expect(fts.error).toBeNull();
    expect((fts.data as { note_id: string }[]).length).toBeGreaterThan(0);
    expect((fts.data as { note_id: string }[]).filter((r) => invisibleIds.has(r.note_id))).toEqual([]);
    const vec = await stubDeps.embedder!.embed(["合言葉"], "query");
    const v = await kenta.rpc("search_chunks_vector", { p_embedding: `[${vec[0].join(",")}]`, p_limit: 200 });
    expect(v.error).toBeNull();
    expect((v.data as { note_id: string }[]).length).toBeGreaterThan(0);
    expect((v.data as { note_id: string }[]).filter((r) => invisibleIds.has(r.note_id))).toEqual([]);
  });
});

describe("日本語検索と異常系", () => {
  it("AC-033: 2文字の語『宿泊』で本文に『宿泊費』を含むノートが hits に入る", async () => {
    const r = await searchAs("misaki", "宿泊");
    expect(noteIds(r.hits)).toContain(noteId("travel-new"));
  });

  it("AC-035: クエリ展開がエラーを返しても、元のクエリだけで検索した結果を返しエラーにしない", async () => {
    const failing: QueryExpander = { expand: async () => Promise.reject(new Error("LLM 500")) };
    const baseline = await searchAs("misaki", "出張の宿泊費の上限");
    const r = await searchAs("misaki", "出張の宿泊費の上限", { ...stubDeps, expander: failing });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r).toEqual(baseline);
  });
});

describe("差分テスト", () => {
  it("AC-103: 閲覧できないノートを消す前と後で hits / superseded_context / conflicts が一致する", async () => {
    const dbUrl = loadTestEnv().databaseUrl;
    try {
      for (const user of ["misaki", "kenta", "sho", "outsider"] as UserName[]) {
        await seed(dbUrl);
        const queries = ["合言葉", "宿泊費の上限", "決済サービス"];
        const before = await Promise.all(queries.map((q) => searchAs(user, q)));
        const { invisible } = expectedVisibility(user);
        // 見えている superseded ノートの置き換え先（AC-028 の表示）は消さない
        const { rows } = await admin().query("select superseded_by from public.notes where superseded_by is not null");
        const keep = new Set(rows.map((r) => r.superseded_by));
        const del = invisible.map((n) => n.id).filter((id) => !keep.has(id));
        await admin().query("delete from public.note_relation where from_note_id = any($1) or to_note_id = any($1)", [del]);
        await admin().query("delete from public.notes where id = any($1)", [del]);
        const after = await Promise.all(queries.map((q) => searchAs(user, q)));
        const pick = (r: typeof before[number]) => ({ hits: r.hits, superseded_context: r.superseded_context, conflicts: r.conflicts });
        expect(after.map(pick), user).toEqual(before.map(pick));
      }
    } finally {
      await seed(dbUrl);
    }
  });
});

describe("非機能", () => {
  it("AC-036: 1,000件のノートで検索を100回実行した p95 が 800ms 以下", async () => {
    const ws = (await admin().query("select id from public.workspace order by name limit 1")).rows[0].id as string;
    const misakiId = (await admin().query("select user_id from public.member where workspace_id = $1 and user_id = '11111111-1111-4111-8111-111111111111'", [ws])).rows[0]?.user_id;
    expect(misakiId).toBeDefined();
    const ids: string[] = [];
    try {
      const topics = ["経費精算", "出張申請", "勤怠管理", "情報セキュリティ", "採用面接", "契約審査", "在宅勤務", "備品購入", "顧客対応", "障害報告"];
      for (let i = 0; i < 1000; i++) {
        const t = topics[i % topics.length];
        const id = await createNote({ owner: "misaki", visibility: "workspace", title: `${t} 手順書 ${i}`, body: `# ${t}\n\n${t}の手順 第${i}版。担当部署へ申請し承認を得る。` });
        ids.push(id);
      }
      for (const id of ids) await indexNote(id);
      const queries = ["経費精算の手順", "出張申請", "情報セキュリティ", "在宅勤務の申請", "障害報告"];
      const times: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        await searchAs("misaki", queries[i % queries.length]);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1];
      console.log(`AC-036 p95=${p95.toFixed(1)}ms p50=${times[49].toFixed(1)}ms`);
      expect(p95).toBeLessThanOrEqual(800);
    } finally {
      await admin().query("delete from public.notes where id = any($1)", [ids]);
    }
  }, 600_000);
});

void share;

describe("conflicts は両端が active のときだけ", () => {
  it("AC-029: contradicts の相手が superseded のときは conflicts に入れない（§6.1）", async () => {
    const token = uniq("旧版との矛盾");
    const a = await createNote({ owner: "misaki", title: `${token} 現行`, body: `${token} は1万円` });
    const b = await createNote({ owner: "misaki", title: `${token} 旧版`, body: `${token} は2万円` });
    const c = await createNote({ owner: "misaki", title: `${token} 新版`, body: `${token} の新版` });
    await relate(a, b, "contradicts");
    await relate(c, b, "supersedes", "confirmed");
    for (const id of [a, b, c]) await indexNote(id);
    const r = await searchAs("misaki", token);
    expect(r.conflicts.filter((x) => x.note_ids.includes(a) && x.note_ids.includes(b))).toEqual([]);
  });
});
