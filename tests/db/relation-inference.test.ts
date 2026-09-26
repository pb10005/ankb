// @covers AC-051, AC-053, AC-054, AC-055, AC-059, AC-114
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, asUser, closeAdmin, createNote, relate } from "../helpers/db";
import { indexNote } from "../helpers/search";
import { drainRelationQueue } from "../../src/jobs/relation-inference";
import { closeJobPool } from "../../src/jobs/db";
import type { Judge, Judgement, NoteText } from "../../src/jobs/judge";

afterAll(async () => {
  await closeAdmin();
  await closeJobPool();
});

beforeEach(async () => {
  await admin().query("select pgmq.purge_queue('relation_inference')");
});

const tok = (label: string) => `${label}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const sup = (confidence: number): Judgement => ({ type: "supersedes", direction: "target_supersedes_candidate", confidence, rationale: "改定されたため" });

/** 呼び出しを記録し、候補ごとの判定を返す偽の判定器 */
function fakeJudge(fn: (target: NoteText, cand: NoteText, call: number) => Judgement | Promise<Judgement>) {
  const calls: { target: string; cand: string }[] = [];
  const judge: Judge = {
    judge: async (t, c) => {
      calls.push({ target: t.id, cand: c.id });
      return fn(t, c, calls.length);
    },
  };
  return { judge, calls };
}

async function activeNote(title: string, body: string, owner: "misaki" | "kenta" = "misaki", visibility: "workspace" | "private" = "workspace") {
  const id = await createNote({ owner, title, body, visibility });
  await indexNote(id);
  return id;
}

/** ノートを保存（本文を変える）して推定キューに積む */
async function touch(id: string) {
  await admin().query("select pgmq.purge_queue('relation_inference')");
  await admin().query("update public.notes set body = body || ' ' where id = $1", [id]);
}

const pairRelations = async (a: string, b: string) =>
  (await admin().query("select * from public.note_relation where (from_note_id = $1 and to_note_id = $2) or (from_note_id = $2 and to_note_id = $1)", [a, b])).rows;

describe("置き換えの推定ジョブ（§6.2）", () => {
  it("AC-054: 確信度0.70の候補だけ proposed で作成し、0.69の候補は作成しない", async () => {
    const t = tok("しきい値");
    const c1 = await activeNote(`${t} 候補1`, `${t} の規程 本文`);
    const c2 = await activeNote(`${t} 候補2`, `${t} の規程 本文`);
    const target = await activeNote(`${t} 新版`, `${t} の規程 本文 改定`);
    await touch(target);
    const { judge } = fakeJudge((_t, c) => sup(c.id === c1 ? 0.7 : 0.69));
    await drainRelationQueue({ judge });
    const r1 = await pairRelations(target, c1);
    expect(r1).toHaveLength(1);
    expect([r1[0].state, r1[0].proposed_by, r1[0].confidence]).toEqual(["proposed", "ai", 0.7]);
    expect(await pairRelations(target, c2)).toHaveLength(0);
  });

  it("AC-055: 類似度の高い active ノートが8件あっても判定は最大5件で、6件目以降との関係は作らない", async () => {
    const t = tok("候補数");
    const cands: string[] = [];
    for (let i = 0; i < 8; i++) cands.push(await activeNote(`${t} 候補${i}`, `${t} 出張の宿泊費の上限 候補${i}`));
    const target = await activeNote(`${t} 新版`, `${t} 出張の宿泊費の上限 新版`);
    await touch(target);
    const { judge, calls } = fakeJudge(() => sup(0.9));
    await drainRelationQueue({ judge });
    expect(calls.length).toBe(5);
    const judged = new Set(calls.map((c) => c.cand));
    for (const c of cands) expect((await pairRelations(target, c)).length).toBe(judged.has(c) ? 1 : 0);
  });

  it("AC-059: LLM が5xxを返し続けると最大4回試行した後に失敗を記録し、関係を作らない（ノートの保存は成功している）", async () => {
    const t = tok("失敗");
    const cand = await activeNote(`${t} 旧版`, `${t} の規程`);
    const target = await activeNote(`${t} 新版`, `${t} の規程 改定`);
    await touch(target);
    const { judge, calls } = fakeJudge(() => Promise.reject(Object.assign(new Error("500 Internal Server Error"), { status: 500 })));
    const res = await drainRelationQueue({ judge });
    expect(res.failed).toBe(1);
    expect(calls.length).toBe(4);
    const { rows } = await admin().query("select attempts, error from jobs.relation_job_failure where note_id = $1", [target]);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(4);
    expect(await pairRelations(target, cand)).toHaveLength(0);
    expect((await admin().query("select status from public.notes where id = $1", [target])).rows[0].status).toBe("active");
    expect((await admin().query("select count(*)::int n from pgmq.q_relation_inference")).rows[0].n).toBe(0);
  });

  it("AC-114: 既存の proposed がある組と、途中の5xx後の再試行を経ても各組の note_relation は1件のまま", async () => {
    const t = tok("冪等");
    const a = await activeNote(`${t} A`, `${t} 共通の本文 A`);
    const others: string[] = [];
    for (let i = 0; i < 4; i++) others.push(await activeNote(`${t} 候補${i}`, `${t} 共通の本文 候補${i}`));
    const n = await activeNote(`${t} N`, `${t} 共通の本文 N`);
    await relate(n, a, "supersedes"); // N↔A は proposed で存在（人の提案）
    await touch(n);
    let failedOnce = false;
    const { judge } = fakeJudge((_t, _c, call) => {
      if (call === 4 && !failedOnce) {
        failedOnce = true;
        throw new Error("503");
      }
      return sup(0.9);
    });
    await drainRelationQueue({ judge });
    // 再度保存して、もう一度推定させる
    await touch(n);
    await drainRelationQueue({ judge });
    expect(failedOnce).toBe(true);
    expect(await pairRelations(n, a)).toHaveLength(1);
    for (const o of others) expect((await pairRelations(n, o)).length).toBeLessThanOrEqual(1);
    expect((await Promise.all(others.map((o) => pairRelations(n, o)))).flat().length).toBe(4);
  });

  it("AC-051: 却下された組は、ノートを再度保存しても新しい提案を作らない", async () => {
    const t = tok("却下");
    const old = await activeNote(`${t} 旧版`, `${t} 規程本文`);
    const nw = await activeNote(`${t} 新版`, `${t} 規程本文 改定`);
    await touch(nw);
    const { judge } = fakeJudge(() => sup(0.9));
    await drainRelationQueue({ judge });
    const [rel] = await pairRelations(nw, old);
    const misaki = await asUser("misaki");
    expect((await misaki.rpc("resolve_relation", { p_relation_id: rel.id, p_decision: "reject" })).error).toBeNull();
    await touch(nw);
    await drainRelationQueue({ judge });
    const rows = await pairRelations(nw, old);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("rejected");
  });
});

describe("提案の見え方（§5.2-4）", () => {
  it("AC-053: 片方を閲覧できない提案は、処理対象の一覧（件数の元）に含まれない", async () => {
    const t = tok("非公開相手");
    const visible = await activeNote(`${t} 公開`, `${t} 本文`, "misaki", "workspace");
    const hidden = await activeNote(`${t} 非公開`, `${t} 本文`, "misaki", "private");
    await admin().query(
      "insert into public.note_relation (from_note_id, to_note_id, type, proposed_by, confidence, rationale) values ($1, $2, 'supersedes', 'ai', 0.9, '理由')",
      [hidden, visible],
    );
    const kenta = await asUser("kenta");
    const { data, error } = await kenta.rpc("pending_relations");
    expect(error).toBeNull();
    const ids = (data as { from_note_id: string; to_note_id: string }[]).flatMap((r) => [r.from_note_id, r.to_note_id]);
    expect(ids).not.toContain(hidden);
  });
});
