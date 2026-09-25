// @covers AC-006, AC-007, AC-008, AC-009, AC-016, AC-017, AC-085, AC-086, AC-087, AC-088, AC-089, AC-090, AC-091, AC-092
import { afterAll, describe, expect, it } from "vitest";
import { admin, asAnon, asUser, closeAdmin, createNote, OTHER_WS, SAMPLE_WS, share, uid, noteRow } from "../helpers/db";
import { loadScenarios, noteId } from "../../src/seed/fixtures";
import { seed } from "../../src/seed/seed";
import { loadTestEnv } from "../helpers/env";

afterAll(closeAdmin);

const NOTE_COLS = "id, title, body, status, visibility";

describe("閲覧権限（§5.1）", () => {
  it("AC-006: 美咲の private ノートを同じ workspace の健太が SELECT すると0行", async () => {
    const kenta = await asUser("kenta");
    const { data, error } = await kenta.from("notes").select(NOTE_COLS).eq("id", noteId("perm-misaki-private"));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AC-007: 健太にだけ view 共有した shared ノートは健太に1行、翔に0行", async () => {
    const id = await createNote({ owner: "misaki", visibility: "shared" });
    await share(id, "kenta", "view");
    const kenta = await asUser("kenta");
    const sho = await asUser("sho");
    const k = await kenta.from("notes").select(NOTE_COLS).eq("id", id);
    const s = await sho.from("notes").select(NOTE_COLS).eq("id", id);
    expect(k.error).toBeNull();
    expect(k.data).toHaveLength(1);
    expect(s.error).toBeNull();
    expect(s.data).toEqual([]);
  });

  it("AC-008: workspace 公開ノートは W のメンバーに1行、W に属さないユーザーに0行", async () => {
    const id = noteId("perm-misaki-workspace");
    const member = await (await asUser("kenta")).from("notes").select(NOTE_COLS).eq("id", id);
    const outsider = await (await asUser("outsider")).from("notes").select(NOTE_COLS).eq("id", id);
    expect(member.data).toHaveLength(1);
    expect(outsider.error).toBeNull();
    expect(outsider.data).toEqual([]);
  });

  it("AC-092: workspace の owner でも他のメンバーの private ノートは0行", async () => {
    const yuki = await asUser("yuki");
    const ids = ["perm-misaki-private", "perm-kenta-private", "perm-sho-private"].map(noteId);
    const { data, error } = await yuki.from("notes").select(NOTE_COLS).in("id", ids);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AC-017: anon ロールで notes / note_relation / note_chunk を SELECT すると3テーブルとも0行", async () => {
    const anon = asAnon();
    await admin().query("insert into public.note_chunk (note_id, chunk_index, content) values ($1, 0, 'anon テスト用チャンク')", [
      noteId("perm-misaki-workspace"),
    ]);
    const n = await anon.from("notes").select(NOTE_COLS);
    const r = await anon.from("note_relation").select("id");
    const c = await anon.from("note_chunk").select("id");
    for (const res of [n, r, c]) {
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    }
  });
});

describe("編集権限（§5.1）", () => {
  it("AC-009: view 共有の健太の UPDATE は0行更新で本文不変、edit 共有の翔の UPDATE は1行更新", async () => {
    const id = await createNote({ owner: "misaki", visibility: "shared", body: "元の本文" });
    await share(id, "kenta", "view");
    await share(id, "sho", "edit");
    const kenta = await asUser("kenta");
    const k = await kenta.from("notes").update({ body: "健太が書き換え" }, { count: "exact" }).eq("id", id);
    expect(k.error).toBeNull();
    expect(k.count).toBe(0);
    expect((await noteRow(id)).body).toBe("元の本文");

    const sho = await asUser("sho");
    const s = await sho.from("notes").update({ body: "翔が書き換え" }, { count: "exact" }).eq("id", id);
    expect(s.error).toBeNull();
    expect(s.count).toBe(1);
    expect((await noteRow(id)).body).toBe("翔が書き換え");
  });
});

describe("書き込みによる権限昇格の防止", () => {
  it("AC-085: 健太が美咲の private ノートの note_share を自分宛てに INSERT すると拒否され、以後も SELECT は0行", async () => {
    const kenta = await asUser("kenta");
    const p = noteId("perm-misaki-private");
    const ins = await kenta.from("note_share").insert({ note_id: p, workspace_id: SAMPLE_WS, user_id: uid("kenta"), permission: "view" });
    expect(ins.error).not.toBeNull();
    const { rows } = await admin().query("select count(*)::int as n from public.note_share where note_id = $1", [p]);
    expect(rows[0].n).toBe(0);
    const sel = await kenta.from("notes").select(NOTE_COLS).eq("id", p);
    expect(sel.data).toEqual([]);
  });

  it("AC-086: 非メンバーの member INSERT と、member の role=owner への自己昇格はどちらも拒否され member は不変", async () => {
    const before = (await admin().query("select workspace_id, user_id, role from public.member order by 1, 2")).rows;
    const outsider = await asUser("outsider");
    const ins = await outsider.from("member").insert({ workspace_id: SAMPLE_WS, user_id: uid("outsider"), role: "member" });
    expect(ins.error).not.toBeNull();
    const kenta = await asUser("kenta");
    const upd = await kenta.from("member").update({ role: "owner" }).eq("workspace_id", SAMPLE_WS).eq("user_id", uid("kenta"));
    expect(upd.error).not.toBeNull();
    const after = (await admin().query("select workspace_id, user_id, role from public.member order by 1, 2")).rows;
    expect(after).toEqual(before);
  });

  it("AC-087: edit 共有の翔による visibility・owner_id・workspace_id の UPDATE と note_share の INSERT は4操作とも拒否され各値は不変", async () => {
    const id = await createNote({ owner: "misaki", visibility: "shared" });
    await share(id, "sho", "edit");
    const before = await noteRow(id);
    const sho = await asUser("sho");
    const results = [
      await sho.from("notes").update({ visibility: "workspace" }).eq("id", id),
      await sho.from("notes").update({ owner_id: uid("sho") }).eq("id", id),
      await sho.from("notes").update({ workspace_id: OTHER_WS }).eq("id", id),
      await sho.from("note_share").insert({ note_id: id, workspace_id: SAMPLE_WS, user_id: uid("kenta"), permission: "edit" }),
    ];
    for (const r of results) expect(r.error).not.toBeNull();
    const after = await noteRow(id);
    expect([after.visibility, after.owner_id, after.workspace_id]).toEqual([before.visibility, before.owner_id, before.workspace_id]);
    const { rows } = await admin().query("select user_id, permission from public.note_share where note_id = $1", [id]);
    expect(rows).toEqual([{ user_id: uid("sho"), permission: "edit" }]);
  });

  it("AC-088: 他人を owner_id に指定、または所属しない workspace_id を指定した notes の INSERT は拒否され保存されない", async () => {
    const kenta = await asUser("kenta");
    const t1 = `なりすまし ${Date.now()}`;
    const t2 = `越境 ${Date.now()}`;
    const a = await kenta.from("notes").insert({ workspace_id: SAMPLE_WS, owner_id: uid("misaki"), title: t1 });
    const b = await kenta.from("notes").insert({ workspace_id: OTHER_WS, owner_id: uid("kenta"), title: t2 });
    expect(a.error).not.toBeNull();
    expect(b.error).not.toBeNull();
    const { rows } = await admin().query("select count(*)::int as n from public.notes where title in ($1, $2)", [t1, t2]);
    expect(rows[0].n).toBe(0);
  });
});

describe("notes 以外のテーブル経由の漏洩", () => {
  it("AC-089: 美咲の private ノートの chunk / version / share は健太の SELECT に行としても件数としても現れない", async () => {
    const p = await createNote({ owner: "misaki", visibility: "private", body: "版1" });
    await admin().query("insert into public.note_chunk (note_id, chunk_index, content) values ($1, 0, '非公開チャンク')", [p]);
    await admin().query("update public.notes set body = '版2' where id = $1", [p]); // note_version が1件できる
    await admin().query("insert into public.note_share (note_id, workspace_id, user_id, permission) values ($1, $2, $3, 'view')", [
      p,
      SAMPLE_WS,
      uid("sho"),
    ]);
    const { rows: pre } = await admin().query(
      "select (select count(*) from public.note_chunk where note_id = $1)::int c, (select count(*) from public.note_version where note_id = $1)::int v, (select count(*) from public.note_share where note_id = $1)::int s",
      [p],
    );
    expect(pre[0]).toEqual({ c: 1, v: 1, s: 1 });

    const kenta = await asUser("kenta");
    for (const table of ["note_chunk", "note_version", "note_share"] as const) {
      const byId = await kenta.from(table).select("note_id").eq("note_id", p);
      expect(byId.error).toBeNull();
      expect(byId.data).toEqual([]);
      const all = await kenta.from(table).select("note_id", { count: "exact" });
      expect(all.error).toBeNull();
      expect((all.data ?? []).some((r: { note_id: string }) => r.note_id === p)).toBe(false);
      // 件数は健太に見える行数と一致する（P の行が数に含まれていない）
      expect(all.count).toBe((all.data ?? []).length);
    }
  });

  it("AC-090: workspace 公開ノートを private に変えた直後、健太の note_chunk の SELECT は0行", async () => {
    const id = await createNote({ owner: "misaki", visibility: "workspace" });
    await admin().query("insert into public.note_chunk (note_id, chunk_index, content) values ($1, 0, '公開チャンク')", [id]);
    const kenta = await asUser("kenta");
    expect((await kenta.from("note_chunk").select("id").eq("note_id", id)).data).toHaveLength(1);
    const misaki = await asUser("misaki");
    const upd = await misaki.from("notes").update({ visibility: "private" }).eq("id", id);
    expect(upd.error).toBeNull();
    const after = await kenta.from("note_chunk").select("id").eq("note_id", id);
    expect(after.error).toBeNull();
    expect(after.data).toEqual([]);
  });
});

describe("DB の構成", () => {
  it("AC-091: public の SECURITY DEFINER 関数は許可リストと一致し、すべて search_path を設定している", async () => {
    const { rows } = await admin().query(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef order by 1`,
    );
    expect(rows.map((r) => r.proname).sort()).toEqual(
      ["can_edit_note", "can_view_note", "note_relation_after_state_change", "resolve_relation"].sort(),
    );
    for (const r of rows) {
      expect((r.proconfig ?? []).some((c: string) => c.startsWith("search_path="))).toBe(true);
    }
  });

  it("AC-016: 空のDBでシードを実行すると3シナリオのノートを作成し fixtures/ の定義件数と一致する", async () => {
    await admin().query("truncate public.note_relation, public.note_chunk, public.note_version, public.note_share, public.notes cascade");
    expect((await admin().query("select count(*)::int n from public.notes")).rows[0].n).toBe(0);
    const counts = await seed(loadTestEnv().databaseUrl);
    const scenarios = loadScenarios();
    expect(scenarios.map((s) => s.scenario)).toEqual([
      "出張規程シナリオ（UC1）",
      "決済サービス選定シナリオ（UC2）",
      "権限シナリオ（private / shared / workspace × 3ユーザー）",
    ]);
    const expectedNotes = scenarios.reduce((n, s) => n + s.notes.length, 0);
    expect(counts.notes).toBe(expectedNotes);
    for (const s of scenarios) {
      const ids = s.notes.map((n) => noteId(n.slug));
      const { rows } = await admin().query("select count(*)::int n from public.notes where id = any($1)", [ids]);
      expect(rows[0].n).toBe(s.notes.length);
    }
    const { rows: total } = await admin().query("select count(*)::int n from public.notes");
    expect(total[0].n).toBe(expectedNotes);
  });
});
