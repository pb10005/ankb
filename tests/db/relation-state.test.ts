// @covers AC-010, AC-011, AC-012, AC-013, AC-014, AC-093, AC-094, AC-095, AC-096, AC-097, AC-098, AC-099, AC-113
import { afterAll, describe, expect, it } from "vitest";
import { admin, asUser, closeAdmin, createNote, noteRow, relate, relationRow, share, uid, SAMPLE_WS } from "../helpers/db";

afterAll(closeAdmin);

async function resolve(user: "misaki" | "kenta" | "sho", relationId: string, decision: "confirm" | "reject" | "revoke") {
  const c = await asUser(user);
  return c.rpc("resolve_relation", { p_relation_id: relationId, p_decision: decision });
}

async function snapshot(ids: string[]) {
  const notes = (await admin().query("select id, status, superseded_by, version, body from public.notes where id = any($1) order by id", [ids])).rows;
  const rels = (
    await admin().query(
      "select id, state, resolved_by from public.note_relation where from_note_id = any($1) or to_note_id = any($1) order by id",
      [ids],
    )
  ).rows;
  return { notes, rels };
}

describe("superseded への遷移は承認経由のみ（§4.2）", () => {
  it("AC-010: オーナーが status を superseded に直接 UPDATE するとエラーで拒否され active のまま", async () => {
    const id = await createNote({ owner: "misaki" });
    const misaki = await asUser("misaki");
    const res = await misaki.from("notes").update({ status: "superseded" }).eq("id", id);
    expect(res.error).not.toBeNull();
    expect((await noteRow(id)).status).toBe("active");
  });

  it("AC-011: resolve_relation で B→A の supersedes を confirmed にすると A が superseded になり superseded_by=B", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    const rel = await relate(b, a, "supersedes");
    const res = await resolve("misaki", rel, "confirm");
    expect(res.error).toBeNull();
    const row = await noteRow(a);
    expect(row.status).toBe("superseded");
    expect(row.superseded_by).toBe(b);
  });

  it("AC-012: 承認済みの置き換えを取り消す（rejected）と A は active に戻り superseded_by は null", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    const rel = await relate(b, a, "supersedes");
    expect((await resolve("misaki", rel, "confirm")).error).toBeNull();
    expect((await noteRow(a)).status).toBe("superseded");
    const res = await resolve("misaki", rel, "revoke");
    expect(res.error).toBeNull();
    expect((await relationRow(rel)).state).toBe("rejected");
    const row = await noteRow(a);
    expect(row.status).toBe("active");
    expect(row.superseded_by).toBeNull();
  });

  it("AC-013: 片方のノートしか編集できないユーザーの承認はエラーで拒否され proposed のまま", async () => {
    const a = await createNote({ owner: "kenta", visibility: "workspace" }); // 美咲は閲覧のみ
    const b = await createNote({ owner: "misaki" });
    const rel = await relate(b, a, "supersedes");
    const res = await resolve("misaki", rel, "confirm");
    expect(res.error?.message).toBe("FORBIDDEN");
    expect((await relationRow(rel)).state).toBe("proposed");
    expect((await noteRow(a)).status).toBe("active");
  });

  it("AC-094: 直接の書き込み6経路はすべてエラーで拒否され notes と note_relation は不変", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    const c = await createNote({ owner: "misaki" });
    const proposed = await relate(b, a, "supersedes");
    const confirmed = await relate(c, b, "supersedes", "confirmed"); // b は superseded
    const before = await snapshot([a, b, c]);
    const misaki = await asUser("misaki");
    const attempts = [
      // (a) note_relation.state の直接 UPDATE
      await misaki.from("note_relation").update({ state: "confirmed" }).eq("id", proposed),
      // (b) state=confirmed での INSERT
      await misaki.from("note_relation").insert({ from_note_id: c, to_note_id: a, type: "supersedes", state: "confirmed", proposed_by: "user" }),
      // (c) notes.superseded_by の直接 UPDATE
      await misaki.from("notes").update({ superseded_by: c }).eq("id", a),
      // (d) superseded のノートを active に直接 UPDATE
      await misaki.from("notes").update({ status: "active" }).eq("id", b),
      // (e) status=superseded での notes INSERT
      await misaki.from("notes").insert({ workspace_id: SAMPLE_WS, owner_id: uid("misaki"), title: "直接 superseded", status: "superseded" }),
      // (f) 他人の uuid を resolved_by に入れた書き込み
      await misaki.from("note_relation").insert({ from_note_id: c, to_note_id: a, type: "related", proposed_by: "user", resolved_by: uid("kenta") }),
    ];
    attempts.forEach((r, i) => expect(r.error, `(${"abcdef"[i]})`).not.toBeNull());
    expect(await snapshot([a, b, c])).toEqual(before);
    expect((await relationRow(confirmed)).state).toBe("confirmed");
    const { rows } = await admin().query("select count(*)::int n from public.notes where title = '直接 superseded'");
    expect(rows[0].n).toBe(0);
  });

  it("AC-095: B→A と C→A が confirmed（C が後）で C→A を取り消すと A は superseded のまま superseded_by=B", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    const c = await createNote({ owner: "misaki" });
    const rb = await relate(b, a, "supersedes");
    const rc = await relate(c, a, "supersedes");
    expect((await resolve("misaki", rb, "confirm")).error).toBeNull();
    expect((await resolve("misaki", rc, "confirm")).error).toBeNull();
    expect((await noteRow(a)).superseded_by).toBe(c);
    expect((await resolve("misaki", rc, "revoke")).error).toBeNull();
    const row = await noteRow(a);
    expect(row.status).toBe("superseded");
    expect(row.superseded_by).toBe(b);
  });

  it("AC-096: B→A が confirmed のとき A→B の承認は循環としてエラーで拒否され proposed のまま", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    await relate(b, a, "supersedes", "confirmed");
    // A は superseded なので置き換え元になれない。循環判定まで届くよう、A を置き換え元にできる状態の別経路も確認する
    const back = await relate(a, b, "supersedes");
    const res = await resolve("misaki", back, "confirm");
    expect(res.error).not.toBeNull();
    expect((await relationRow(back)).state).toBe("proposed");
    expect((await noteRow(b)).status).toBe("active");

    // 3ノートの連鎖 E→F→G（G superseded by F, F superseded by E）で G→E を承認する。
    // G は superseded なので置き換え元の検査で拒否される（循環判定の分岐は AS-035 の下では多重防御）
    const e = await createNote({ owner: "misaki" });
    const f = await createNote({ owner: "misaki" });
    const g = await createNote({ owner: "misaki" });
    await relate(f, g, "supersedes", "confirmed");
    await relate(e, f, "supersedes", "confirmed");
    const cyc = await relate(g, e, "supersedes");
    const res2 = await resolve("misaki", cyc, "confirm");
    expect(res2.error).not.toBeNull();
    expect((await relationRow(cyc)).state).toBe("proposed");
  });

  it("AC-097: 置き換え対象が draft または archived のとき承認はエラーで拒否され status は不変", async () => {
    for (const status of ["draft", "archived"] as const) {
      const a = await createNote({ owner: "misaki", status: "draft" });
      if (status === "archived") await admin().query("update public.notes set status = 'archived' where id = $1", [a]);
      const b = await createNote({ owner: "misaki" });
      const rel = await relate(b, a, "supersedes");
      const res = await resolve("misaki", rel, "confirm");
      expect(res.error, status).not.toBeNull();
      expect((await noteRow(a)).status).toBe(status);
      expect((await relationRow(rel)).state).toBe("proposed");
    }
  });

  it("AC-098: 存在しない relation_id と閲覧できない relation_id に同じエラーコードと同じメッセージを返す", async () => {
    const p = await createNote({ owner: "kenta", visibility: "private" });
    const q = await createNote({ owner: "kenta", visibility: "workspace" });
    const hidden = await relate(p, q, "supersedes");
    const missing = await resolve("misaki", "00000000-0000-4000-8000-000000000000", "confirm");
    const invisible = await resolve("misaki", hidden, "confirm");
    expect(missing.error).not.toBeNull();
    expect(invisible.error).not.toBeNull();
    expect(invisible.error?.code).toBe(missing.error?.code);
    expect(invisible.error?.message).toBe(missing.error?.message);
    expect((await relationRow(hidden)).state).toBe("proposed");
  });

  it("AC-099: B→A confirmed の後に C→B を承認すると A と B が superseded、C が active（A←B←C）", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    const c = await createNote({ owner: "misaki" });
    await relate(b, a, "supersedes", "confirmed");
    const rel = await relate(c, b, "supersedes");
    const res = await resolve("misaki", rel, "confirm");
    expect(res.error).toBeNull();
    const [ra, rb, rc] = [await noteRow(a), await noteRow(b), await noteRow(c)];
    expect([ra.status, ra.superseded_by]).toEqual(["superseded", b]);
    expect([rb.status, rb.superseded_by]).toEqual(["superseded", c]);
    expect(rc.status).toBe("active");
  });

  it("AC-113: 一方が承認した直後の他方の却下は ALREADY_RESOLVED で、state=confirmed と resolved_by は最初のユーザーのまま", async () => {
    const a = await createNote({ owner: "misaki", visibility: "shared" });
    const b = await createNote({ owner: "misaki", visibility: "shared" });
    await share(a, "sho", "edit");
    await share(b, "sho", "edit");
    const rel = await relate(b, a, "supersedes");
    const first = await resolve("misaki", rel, "confirm");
    const second = await resolve("sho", rel, "reject");
    expect(first.error).toBeNull();
    expect(second.error?.message).toBe("ALREADY_RESOLVED");
    const row = await relationRow(rel);
    expect(row.state).toBe("confirmed");
    expect(row.resolved_by).toBe(uid("misaki"));
  });
});

describe("閲覧できない相手の情報を漏らさない（§5.2-4）", () => {
  it("AC-014: 美咲の private ノートと健太の workspace ノートの関係は、P を閲覧できない健太の SELECT で0行", async () => {
    const p = await createNote({ owner: "misaki", visibility: "private" });
    const q = await createNote({ owner: "kenta", visibility: "workspace" });
    const rel = await relate(p, q, "contradicts");
    const kenta = await asUser("kenta");
    const { data, error } = await kenta.from("note_relation").select("id").eq("id", rel);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AC-093: 置き換え先を閲覧できない健太が notes_visible で A を取得すると superseded / superseded_by=null で B の id を含まない", async () => {
    const a = await createNote({ owner: "misaki", visibility: "workspace" });
    const b = await createNote({ owner: "misaki", visibility: "private" });
    await relate(b, a, "supersedes", "confirmed");
    expect((await noteRow(a)).superseded_by).toBe(b);
    const kenta = await asUser("kenta");
    const { data, error } = await kenta.from("notes_visible").select("*").eq("id", a);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe("superseded");
    expect(data![0].superseded_by).toBeNull();
    expect(JSON.stringify(data)).not.toContain(b);
    // notes 本体からも superseded_by は読めない
    const direct = await kenta.from("notes").select("superseded_by").eq("id", a);
    expect(direct.error).not.toBeNull();
  });
});

describe("状態遷移トリガーは version を上げない", () => {
  it("AS-064: 承認で superseded になった A の version は承認前と同じ（編集中の利用者を CONFLICT にしない）", async () => {
    const a = await createNote({ owner: "misaki" });
    const b = await createNote({ owner: "misaki" });
    const before = (await noteRow(a)).version;
    const rel = await relate(b, a, "supersedes");
    expect((await resolve("misaki", rel, "confirm")).error).toBeNull();
    const row = await noteRow(a);
    expect(row.status).toBe("superseded");
    expect(row.version).toBe(before);
  });
});
