// @covers AC-016
// fixtures/ のシナリオ定義（指示書 §9.1）を読み、slug から決定的な UUID を割り当てる。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type Visibility = "private" | "shared" | "workspace";
export type FixtureNote = {
  slug: string;
  workspace: string;
  owner: string;
  visibility: Visibility;
  status: "draft" | "active";
  effective_from?: string;
  title: string;
  body: string;
  shares?: { user: string; permission: "view" | "edit" }[];
};
export type FixtureRelation = {
  from: string;
  to: string;
  type: "supersedes" | "contradicts" | "related";
  state: "proposed" | "confirmed" | "rejected";
  proposed_by: "ai" | "user" | "agent";
  confidence?: number;
  rationale: string;
  resolved_by?: string;
};
export type Scenario = { scenario: string; notes: FixtureNote[]; relations: FixtureRelation[] };
export type Workspaces = {
  users: Record<string, string>;
  workspaces: { slug: string; name: string; members: { user: string; role: "owner" | "member" }[] }[];
};

export const SCENARIO_FILES = ["travel.json", "payment.json", "permissions.json"] as const;

const FIXTURE_DIR = join(process.cwd(), "fixtures");

export function loadWorkspaces(): Workspaces {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "workspaces.json"), "utf8"));
}

export function loadScenarios(): Scenario[] {
  return SCENARIO_FILES.map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")));
}

/** slug から決定的な UUID（v5 形式）を作る。テストはこの関数でフィクスチャの id を引く */
export function fixtureId(kind: "note" | "workspace", slug: string): string {
  const h = createHash("sha1").update(`ankb-fixture:${kind}:${slug}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const noteId = (slug: string) => fixtureId("note", slug);
export const workspaceId = (slug: string) => fixtureId("workspace", slug);
