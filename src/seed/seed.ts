// @covers AC-016
// @assumption AS-042
// fixtures/ のシナリオを DB に投入する。アプリのテーブルを空にしてから入れ直すので、何度実行しても同じ状態になる。
// Postgres に直接接続する（サービスロールキーは使わない: AS-042）。
//
//   npm run seed            # DATABASE_URL 未設定時はローカル Supabase（supabase start）に接続
import pg from "pg";
import { loadScenarios, loadWorkspaces, noteId, workspaceId } from "./fixtures";

export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type SeedCounts = { workspaces: number; members: number; notes: number; shares: number; relations: number };

export async function seed(databaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL): Promise<SeedCounts> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const counts: SeedCounts = { workspaces: 0, members: 0, notes: 0, shares: 0, relations: 0 };
  try {
    await client.query("begin");
    await client.query(
      "truncate public.note_relation, public.note_chunk, public.note_version, public.note_share, public.notes, public.member, public.workspace cascade",
    );

    const ws = loadWorkspaces();
    const userId = (name: string) => {
      const id = ws.users[name];
      if (!id) throw new Error(`fixtures: 未定義のユーザー ${name}`);
      return id;
    };

    for (const w of ws.workspaces) {
      await client.query("insert into public.workspace (id, name) values ($1, $2)", [workspaceId(w.slug), w.name]);
      counts.workspaces++;
      for (const m of w.members) {
        await client.query("insert into public.member (workspace_id, user_id, role) values ($1, $2, $3)", [
          workspaceId(w.slug),
          userId(m.user),
          m.role,
        ]);
        counts.members++;
      }
    }

    for (const scenario of loadScenarios()) {
      for (const n of scenario.notes) {
        await client.query(
          `insert into public.notes (id, workspace_id, owner_id, title, body, status, visibility, effective_from)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [noteId(n.slug), workspaceId(n.workspace), userId(n.owner), n.title, n.body, n.status, n.visibility, n.effective_from ?? null],
        );
        counts.notes++;
        for (const s of n.shares ?? []) {
          await client.query(
            "insert into public.note_share (note_id, workspace_id, user_id, permission) values ($1, $2, $3, $4)",
            [noteId(n.slug), workspaceId(n.workspace), userId(s.user), s.permission],
          );
          counts.shares++;
        }
      }
      for (const r of scenario.relations) {
        // 提案として作ってから状態を変える。superseded への遷移は状態遷移トリガーに任せる
        const { rows } = await client.query(
          `insert into public.note_relation (from_note_id, to_note_id, type, state, proposed_by, confidence, rationale)
           values ($1, $2, $3, 'proposed', $4, $5, $6) returning id`,
          [noteId(r.from), noteId(r.to), r.type, r.proposed_by, r.confidence ?? null, r.rationale],
        );
        if (r.state !== "proposed") {
          await client.query(
            "update public.note_relation set state = $2, resolved_by = $3, resolved_at = clock_timestamp() where id = $1",
            [rows[0].id, r.state, r.resolved_by ? userId(r.resolved_by) : null],
          );
        }
        counts.relations++;
      }
    }
    await client.query("commit");
    return counts;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then((c) => console.log(`seeded: ${JSON.stringify(c)}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
