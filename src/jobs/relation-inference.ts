// @covers AC-049, AC-051, AC-054, AC-055, AC-059, AC-114, AC-116
// @assumption AS-020
// @assumption AS-021
// @assumption AS-023
// @assumption AS-043
// @assumption AS-044
// @assumption AS-074
// 置き換え関係の推定ジョブ（指示書 §6.2）。キュー relation_inference のノートごとに:
//   同じ workspace の active なノートから embedding 類似度の上位 N 件（既に関係がある組は除く）を選び、
//   LLM の判定が supersedes / contradicts / related で確信度がしきい値以上なら note_relation(state=proposed, proposed_by=ai) を作る。
// 失敗したメッセージは再試行し、最大試行回数に達したら失敗を記録して捨てる。
import type pg from "pg";
import { defaultJudge, type Judge, type NoteText } from "./judge";
import { jobPool } from "./db";

export const QUEUE = "relation_inference";

export type InferenceOptions = {
  pool?: pg.Pool;
  judge?: Judge;
  topN?: number;
  threshold?: number;
  /** 初回 + 再試行3回（AS-074） */
  maxAttempts?: number;
  /** 1回の呼び出しで処理する最大メッセージ数 */
  batch?: number;
};

const envNumber = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
};

export async function drainRelationQueue(opts: InferenceOptions = {}): Promise<{ processed: number; failed: number }> {
  const pool = opts.pool ?? jobPool();
  const judge = opts.judge ?? defaultJudge();
  const topN = opts.topN ?? envNumber("ANKB_RELATION_TOP_N", 5);
  const threshold = opts.threshold ?? envNumber("ANKB_RELATION_THRESHOLD", 0.7);
  const maxAttempts = opts.maxAttempts ?? 4;
  const batch = opts.batch ?? 20;
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < batch; i++) {
    // 可視性タイムアウト 60 秒で1件取り出す（他のワーカーと二重に処理しない）
    const { rows } = await pool.query<{ msg_id: string; read_ct: number; message: { note_id: string } }>(
      "select msg_id, read_ct, message from pgmq.read($1, 60, 1)",
      [QUEUE],
    );
    if (rows.length === 0) break;
    const msg = rows[0];
    try {
      await inferForNote(pool, judge, msg.message.note_id, topN, threshold);
      await pool.query("select pgmq.delete($1, $2::bigint)", [QUEUE, msg.msg_id]);
      processed++;
    } catch (e) {
      if (msg.read_ct >= maxAttempts) {
        await pool.query("insert into jobs.relation_job_failure (note_id, attempts, error) values ($1, $2, $3)", [
          msg.message.note_id,
          msg.read_ct,
          e instanceof Error ? e.message : String(e),
        ]);
        await pool.query("select pgmq.archive($1, $2::bigint)", [QUEUE, msg.msg_id]);
        failed++;
      } else {
        // すぐに再試行できるよう可視化する
        await pool.query("select pgmq.set_vt($1, $2::bigint, 0)", [QUEUE, msg.msg_id]);
      }
    }
  }
  return { processed, failed };
}

async function inferForNote(pool: pg.Pool, judge: Judge, noteId: string, topN: number, threshold: number): Promise<void> {
  const { rows: notes } = await pool.query<NoteText & { workspace_id: string; status: string }>(
    "select id, workspace_id, status, title, body, effective_from::text, updated_at::text from public.notes where id = $1",
    [noteId],
  );
  const target = notes[0];
  if (!target || target.status !== "active") return;

  // 同じ workspace の active なノートを、チャンクの embedding の最大類似度で並べる（既に関係がある組は除く: AS-043）
  const { rows: candidates } = await pool.query<NoteText & { sim: number }>(
    `select n2.id, n2.title, n2.body, n2.effective_from::text, n2.updated_at::text,
            max(1 - (c1.embedding <=> c2.embedding)) as sim
     from public.note_chunk c1
     join public.note_chunk c2 on c2.note_id <> c1.note_id
     join public.notes n2 on n2.id = c2.note_id
     where c1.note_id = $1 and c1.embedding is not null and c2.embedding is not null
       and n2.status = 'active' and n2.workspace_id = $2
       and not exists (
         select 1 from public.note_relation r
         where least(r.from_note_id, r.to_note_id) = least($1::uuid, n2.id)
           and greatest(r.from_note_id, r.to_note_id) = greatest($1::uuid, n2.id)
       )
     group by n2.id
     order by sim desc, n2.id
     limit $3`,
    [noteId, target.workspace_id, topN],
  );

  for (const cand of candidates) {
    const j = await judge.judge(target, cand);
    if (j.type === "none" || !(j.confidence >= threshold)) continue;
    const [from, to] = j.type === "supersedes" && j.direction === "candidate_supersedes_target" ? [cand.id, target.id] : [target.id, cand.id];
    await pool.query(
      `insert into public.note_relation (from_note_id, to_note_id, type, state, proposed_by, confidence, rationale)
       values ($1, $2, $3, 'proposed', 'ai', $4, $5)
       on conflict do nothing`,
      [from, to, j.type, Math.min(1, Math.max(0, j.confidence)), j.rationale],
    );
  }
}
