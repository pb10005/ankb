// @covers AC-133
import { describe, it, expect } from "vitest";
import { safeNextPath } from "../src/lib/safe-next";

describe("safeNextPath", () => {
  it("AC-133: 外部URL・プロトコル相対URL・制御文字入りの next は /dashboard に置き換える", () => {
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/\t/evil.example", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });

  it("AC-133: 同一オリジンの相対パスはそのまま返す", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/notes/abc?x=1")).toBe("/notes/abc?x=1");
  });
});
