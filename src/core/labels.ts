// @covers AC-018, AC-025
// @assumption AS-009
// @assumption AS-061
// UI の表記。専門用語（private / draft など）を画面に出さない（ペルソナA）
export type NoteStatus = "draft" | "active" | "superseded" | "archived";
export type Visibility = "private" | "shared" | "workspace";

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "非公開",
  shared: "指定した人",
  workspace: "チーム全体",
};

export const STATUS_LABEL: Record<NoteStatus, string> = {
  draft: "下書き",
  active: "有効",
  superseded: "置き換え済み",
  archived: "アーカイブ済み",
};

export const PERMISSION_LABEL = { view: "閲覧のみ", edit: "編集できる" } as const;
