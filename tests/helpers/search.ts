// @covers AC-027, AC-032, AC-035
// @assumption AS-016
import { asUser, admin, type UserName } from "./db";
import { searchKnowledge, type SearchResult, type SearchDeps } from "../../src/core/search";
import { StubEmbedder } from "../../src/core/embedding";
import { NoopQueryExpander } from "../../src/core/query-expansion";
import { buildChunkRows } from "../../src/core/indexing";
import { loadScenarios, loadWorkspaces, noteId } from "../../src/seed/fixtures";

export const stubDeps: SearchDeps = { embedder: new StubEmbedder(), expander: new NoopQueryExpander() };

export async function searchAs(user: UserName, query: string, deps: SearchDeps = stubDeps): Promise<SearchResult> {
  return searchKnowledge(await asUser(user), query, deps);
}

/** テストで作ったノートにチャンクを作る（スタブ embedding） */
export async function indexNote(id: string): Promise<void> {
  const { rows } = await admin().query("select title, body from public.notes where id = $1", [id]);
  await admin().query("delete from public.note_chunk where note_id = $1", [id]);
  for (const c of await buildChunkRows(id, rows[0].title, rows[0].body, new StubEmbedder())) {
    await admin().query("insert into public.note_chunk (note_id, chunk_index, content, embedding) values ($1, $2, $3, $4)", [
      c.note_id,
      c.chunk_index,
      c.content,
      c.embedding,
    ]);
  }
}

export const noteIds = (xs: { note_id: string }[]) => xs.map((x) => x.note_id);

/** fixtures の定義から、各ユーザーが閲覧できるノートを §5.1 に従って求める（DB の判定とは独立に計算する） */
export function expectedVisibility(user: UserName): { visible: Set<string>; invisible: { id: string; title: string; body: string }[] } {
  const ws = loadWorkspaces();
  const memberOf = new Set(ws.workspaces.filter((w) => w.members.some((m) => m.user === user)).map((w) => w.slug));
  const visible = new Set<string>();
  const invisible: { id: string; title: string; body: string }[] = [];
  for (const s of loadScenarios()) {
    for (const n of s.notes) {
      const ok =
        n.owner === user ||
        (n.visibility === "workspace" && memberOf.has(n.workspace)) ||
        (n.visibility === "shared" && (n.shares ?? []).some((sh) => sh.user === user));
      if (ok) visible.add(noteId(n.slug));
      else invisible.push({ id: noteId(n.slug), title: n.title, body: n.body });
    }
  }
  return { visible, invisible };
}
