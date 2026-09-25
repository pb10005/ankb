// @covers AC-015
import { afterAll, describe, expect, it } from "vitest";
import { admin, asUser, closeAdmin, createNote, share } from "../helpers/db";

afterAll(closeAdmin);

describe("版履歴", () => {
  it("AC-015: 編集権限を持つユーザーが body を更新すると更新前の body を持つ note_version が1件追加される", async () => {
    const id = await createNote({ owner: "misaki", visibility: "shared", body: "更新前の本文" });
    await share(id, "sho", "edit");
    const count = async () => (await admin().query("select count(*)::int n from public.note_version where note_id = $1", [id])).rows[0].n;
    expect(await count()).toBe(0);
    const sho = await asUser("sho");
    const res = await sho.from("notes").update({ body: "更新後の本文" }, { count: "exact" }).eq("id", id);
    expect(res.error).toBeNull();
    expect(res.count).toBe(1);
    expect(await count()).toBe(1);
    const { rows } = await admin().query("select version, body from public.note_version where note_id = $1", [id]);
    expect(rows).toEqual([{ version: 1, body: "更新前の本文" }]);
  });
});
