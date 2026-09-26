// @covers AC-073, AC-075, AC-076, AC-077, AC-078, AC-079, AC-082, AC-083, AC-127, AC-134
// @assumption AS-027
// @assumption AS-031
// WebMCP が document.modelContext に登録する12ツール（サーバMCPの読み取り系5件 + 画面操作5件 +
// request_relation_approval + propose_relation）。読み取り・書き込み系6件（search_knowledge・ask・get_note・
// get_note_lineage・list_pending_relations・propose_relation）はサーバMCPと同じ toolHandlers() を通す
// /api/webmcp/[tool] を呼ぶ（§1.3 入口の一貫性）。確定操作（承認）は register.tsx のダイアログで人間のクリックを経由する。
import { DRAFT_STORAGE_KEY, webMcpBridge, type ApprovalRelation } from "./bridge";

export type ToolResult = Record<string, unknown>;
export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean };
  execute: (input: Record<string, unknown>, ctx: { signal?: AbortSignal }) => Promise<ToolResult>;
};

type Router = { push: (href: string) => void };

const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "ログインが必要です" } };
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "見つかりませんでした" } };
const UNSAVED_CHANGES = { error: { code: "UNSAVED_CHANGES", message: "保存されていない編集があります" } };

async function apiFetch(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

// search_knowledge / ask / get_note / get_note_lineage / list_pending_relations / propose_relation は
// すべてこの統一エンドポイントを経由する。成功時はハンドラの戻り値がそのまま body になる（AC-072）。
async function callWebMcpTool(name: string, args: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  return apiFetch(`/api/webmcp/${name}`, { method: "POST", body: JSON.stringify(args) });
}

function errorResult(status: number, body: Record<string, unknown>): ToolResult {
  if (status === 401) return UNAUTHENTICATED;
  if (status === 404) return NOT_FOUND;
  // AC-127: 不可視ノートは存在しないノートと同じ扱いにする（403 も NOT_FOUND として返す）
  if (status === 403) return NOT_FOUND;
  return { error: { code: body.code ?? "VALIDATION_ERROR", message: body.message ?? "処理に失敗しました" } };
}

export function createTools(router: Router): Tool[] {
  return [
    {
      name: "search_knowledge",
      description: "ankb のノートをハイブリッド検索する（全文＋意味検索）。閲覧できる範囲だけを検索する。",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const query = String(input.query ?? "").trim();
        if (!query) return { error: { code: "VALIDATION_ERROR", message: "query を指定してください" } };
        const { status, body } = await callWebMcpTool("search_knowledge", { query });
        return status === 200 ? body : errorResult(status, body);
      },
    },
    {
      name: "ask",
      description: "ankb のナレッジベースに質問し、根拠付きの回答を得る。",
      inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const question = String(input.question ?? "").trim();
        if (!question) return { error: { code: "VALIDATION_ERROR", message: "question を指定してください" } };
        const { status, body } = await callWebMcpTool("ask", { question });
        return status === 200 ? body : errorResult(status, body);
      },
    },
    {
      name: "get_note",
      description: "note_id を指定してノートの内容を取得する。",
      inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const noteId = String(input.note_id ?? "");
        const { status, body } = await callWebMcpTool("get_note", { note_id: noteId });
        return status === 200 ? body : errorResult(status, body);
      },
    },
    {
      name: "get_note_lineage",
      description: "ノートの置き換え系譜（過去→現在）を日付の昇順で取得する。",
      inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const noteId = String(input.note_id ?? "");
        const { status, body } = await callWebMcpTool("get_note_lineage", { note_id: noteId });
        // /api/webmcp/get_note_lineage はすでに { lineage: [...] } を返すので二重に包まない
        return status === 200 ? body : errorResult(status, body);
      },
    },
    {
      name: "list_pending_relations",
      description: "承認待ち（proposed）の置き換え・関連の提案一覧を取得する。",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        const { status, body } = await callWebMcpTool("list_pending_relations", {});
        return status === 200 ? body : errorResult(status, body);
      },
    },
    {
      name: "get_current_context",
      description: "今開いている画面の文脈（ノートID・検索/質問クエリ・選択範囲）を取得する。",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        const result: ToolResult = {};
        if (webMcpBridge.currentNoteId) result.note_id = webMcpBridge.currentNoteId;
        if (webMcpBridge.currentQuery) result.query = webMcpBridge.currentQuery;
        const selection = webMcpBridge.getSelectionText();
        if (selection) result.selection = selection;
        return result;
      },
    },
    {
      name: "open_note",
      description: "指定した note_id のノート画面を開く。",
      inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        if (webMcpBridge.hasUnsavedChanges) return UNSAVED_CHANGES;
        const noteId = String(input.note_id ?? "");
        // 遷移前の可視性チェックは実ツールと同じ get_note（ディスパッチャ経由）で行う
        const { status, body } = await callWebMcpTool("get_note", { note_id: noteId });
        if (status !== 200) return errorResult(status, body);
        router.push(`/notes/${noteId}`);
        return { opened: noteId };
      },
    },
    {
      name: "open_compare_view",
      description: "2つの note_id を並べた比較ビューを開く。",
      inputSchema: {
        type: "object",
        properties: { note_id_a: { type: "string" }, note_id_b: { type: "string" } },
        required: ["note_id_a", "note_id_b"],
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const a = String(input.note_id_a ?? "");
        const b = String(input.note_id_b ?? "");
        const [ra, rb] = await Promise.all([callWebMcpTool("get_note", { note_id: a }), callWebMcpTool("get_note", { note_id: b })]);
        if (ra.status !== 200) return errorResult(ra.status, ra.body);
        if (rb.status !== 200) return errorResult(rb.status, rb.body);
        router.push(`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
        return { opened: [a, b] };
      },
    },
    {
      name: "highlight_citation",
      description: "回答画面に表示中の引用マーカー（例: [1]）をハイライトする。",
      inputSchema: { type: "object", properties: { marker: { type: "string" } }, required: ["marker"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const marker = String(input.marker ?? "");
        const ok = webMcpBridge.highlightCitation(marker);
        return ok ? { highlighted: marker } : NOT_FOUND;
      },
    },
    {
      name: "draft_note",
      description: "新規ノートのエディタに title・body を下書きとして表示する（保存はしない）。",
      inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"] },
      annotations: { consequentialHint: true },
      async execute(input) {
        if (webMcpBridge.hasUnsavedChanges) return UNSAVED_CHANGES;
        const title = String(input.title ?? "");
        const body = String(input.body ?? "");
        if (typeof window !== "undefined" && window.sessionStorage) {
          window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ title, body }));
        }
        router.push("/notes/new");
        return { drafted: true };
      },
    },
    {
      name: "request_relation_approval",
      description: "proposed の置き換え・関連の提案について、人間に承認ダイアログを表示する。確定は人間のクリックだけで行われる。",
      inputSchema: { type: "object", properties: { relation_id: { type: "string" } }, required: ["relation_id"] },
      annotations: { consequentialHint: true },
      async execute(input, { signal }) {
        const relationId = String(input.relation_id ?? "");
        // このプリフライト確認自体は WebMCP の統一エンドポイントの対象外の専用ルート（AC-125）
        const { status, body } = await apiFetch(`/api/relations/${encodeURIComponent(relationId)}`);
        if (status !== 200) return errorResult(status, body);
        const { relation, canResolve } = body as { relation: ApprovalRelation & { state: string }; canResolve: boolean };
        if (!canResolve) return { error: { code: "FORBIDDEN", message: "この操作を行う権限がありません" } };
        if (relation.state !== "proposed") return { error: { code: "ALREADY_RESOLVED", message: "すでに判断済みです" } };
        try {
          const outcome = await webMcpBridge.requestApproval(relation, signal);
          return { relation_id: relationId, ...outcome };
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          return { error: { code: "VALIDATION_ERROR", message: (e as Error).message } };
        }
      },
    },
    {
      name: "propose_relation",
      description: "2つのノートの関係（置き換え・矛盾・関連）を提案する。提案は proposed のままで、確定はしない。",
      inputSchema: {
        type: "object",
        properties: {
          from_note_id: { type: "string" },
          to_note_id: { type: "string" },
          type: { type: "string", enum: ["supersedes", "contradicts", "related"] },
          rationale: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["from_note_id", "to_note_id", "type", "rationale"],
      },
      async execute(input) {
        const { status, body } = await callWebMcpTool("propose_relation", {
          from_note_id: input.from_note_id,
          to_note_id: input.to_note_id,
          type: input.type,
          rationale: input.rationale,
        });
        return status === 200 ? body : errorResult(status, body);
      },
    },
  ];
}
