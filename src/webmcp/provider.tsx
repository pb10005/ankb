"use client";
// @covers AC-072, AC-073, AC-074, AC-075, AC-076, AC-077, AC-078, AC-082, AC-083, AC-084, AC-127, AC-128, AC-129, AC-134
// @covers AC-079, AC-080, AC-081, AC-125, AC-126, AC-141
// @assumption AS-027
// @assumption AS-028
// @assumption AS-029
// @assumption AS-031
// @assumption AS-083
// @assumption AS-053
// @assumption AS-056
// WebMCP（document.modelContext）へのツール登録。ログイン中だけ登録し、ログアウト・アンマウント・別タブのログアウトで解除する。
// 読み取り系は Web UI と同じサーバ API をこのブラウザのセッションで呼び、画面操作はこの画面の上で行う。
// 承認などの確定操作は、ダイアログを開くところまで。確定は人間の実際のクリックだけ（isTrusted）。
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { draftStore, editorState, pageContext } from "./context-store";

type Json = Record<string, unknown>;
type ToolDef = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Json;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean };
  execute: (input: Json, options?: { signal?: AbortSignal }) => Promise<unknown>;
};
type ModelContext = {
  registerTool: (tool: ToolDef, options?: { signal?: AbortSignal }) => Promise<void>;
};

const NOT_FOUND = { code: "NOT_FOUND", message: "見つかりません" } as const;
const UNSAVED = { code: "UNSAVED_CHANGES", message: "エディタに保存していない変更があります。先に保存するか破棄してください" } as const;
export const AUTH_CHANNEL = "ankb-auth";

const obj = (properties: Json, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" };

type Approval = {
  id: string;
  message: string;
  rationale: string;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

export function WebMcpProvider() {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  const pathRef = useRef(pathname);
  const [approval, setApproval] = useState<Approval | null>(null);
  const approvalRef = useRef<Approval | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // 画面遷移したら、開いている承認ダイアログは閉じて中断する（AC-126 (c)）
  useEffect(() => {
    pathRef.current = pathname;
    // draft_note の下書きは /notes/new の編集画面にだけ引き継ぎ、そこから離れたら捨てる（AS-083）
    if (pathname !== "/notes/new") draftStore.clear();
    const a = approvalRef.current;
    if (a) {
      approvalRef.current = null;
      setApproval(null);
      a.reject(new DOMException("画面が遷移しました", "AbortError"));
    }
  }, [pathname]);

  useEffect(() => {
    const mc = (document as unknown as { modelContext?: ModelContext }).modelContext;
    if (!mc || typeof mc.registerTool !== "function") return; // 非対応ブラウザでは何もしない（AS-056）
    const controller = new AbortController();
    controllerRef.current = controller;
    const unregister = () => controller.abort();

    /** Web UI のサーバ API を呼ぶ。401 なら登録を解除して UNAUTHENTICATED（AC-129） */
    async function api(path: string, init?: RequestInit): Promise<{ status: number; body: Json }> {
      const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
      const body = (await res.json().catch(() => ({}))) as Json;
      if (res.status === 401) {
        unregister();
        return { status: 401, body: { code: "UNAUTHENTICATED", message: "ログインが必要です" } };
      }
      return { status: res.status, body };
    }
    const tool = async (name: string, args: Json) => {
      const { status, body } = await api(`/api/webmcp/${name}`, { method: "POST", body: JSON.stringify(args) });
      if (status === 401) return body;
      return body.ok ? body.value : body;
    };
    const visible = async (id: unknown) => {
      if (typeof id !== "string") return false;
      const r = (await tool("get_note", { note_id: id })) as Json;
      return !("code" in r);
    };

    const tools: ToolDef[] = [
      {
        name: "search_knowledge",
        description: "ankb のナレッジを検索する。今有効なノート（hits）、旧情報（superseded_context）、食い違い（conflicts）と、回答の契約（synthesis_guidelines）を返す",
        inputSchema: obj({ query: str }, ["query"]),
        annotations: { readOnlyHint: true },
        execute: async ({ query }) => {
          const { body } = await api(`/api/search?q=${encodeURIComponent(String(query ?? ""))}`);
          return body;
        },
      },
      {
        name: "ask",
        description: "質問に ankb が根拠付きで回答する",
        inputSchema: obj({ question: str }, ["question"]),
        execute: ({ question }) => tool("ask", { question }),
      },
      {
        name: "get_note",
        description: "ノートの本文とメタデータ（有効性・更新の可能性・食い違い）を返す",
        inputSchema: obj({ note_id: str }, ["note_id"]),
        annotations: { readOnlyHint: true },
        execute: ({ note_id }) => tool("get_note", { note_id }),
      },
      {
        name: "get_note_lineage",
        description: "置き換えの連鎖を時系列で返す",
        inputSchema: obj({ note_id: str }, ["note_id"]),
        annotations: { readOnlyHint: true },
        execute: ({ note_id }) => tool("get_note_lineage", { note_id }),
      },
      {
        name: "list_pending_relations",
        description: "自分が承認・却下できる未承認の提案を返す",
        inputSchema: obj({}),
        annotations: { readOnlyHint: true },
        execute: () => tool("list_pending_relations", {}),
      },
      {
        name: "get_current_context",
        description: "利用者が今開いている画面（ノート ID、検索クエリ、選択範囲）を返す",
        inputSchema: obj({}),
        annotations: { readOnlyHint: true },
        execute: async () => {
          const c = pageContext.get();
          // §7.2 どおりノート ID・検索クエリ・選択範囲だけを返す
          return {
            ...(c.note_id ? { note_id: c.note_id } : {}),
            ...(c.query ? { query: c.query } : {}),
            selection: window.getSelection()?.toString() ?? "",
          };
        },
      },
      {
        name: "open_note",
        description: "指定したノートを画面に開く",
        inputSchema: obj({ note_id: str }, ["note_id"]),
        annotations: { readOnlyHint: true },
        execute: async ({ note_id }) => {
          if (!(await visible(note_id))) return NOT_FOUND;
          if (editorState.isDirty()) return UNSAVED;
          routerRef.current.push(`/notes/${note_id}`);
          return { opened: note_id };
        },
      },
      {
        name: "open_compare_view",
        description: "2つのノートを並べた比較ビューを開く",
        inputSchema: obj({ a: str, b: str }, ["a", "b"]),
        annotations: { readOnlyHint: true },
        execute: async ({ a, b }) => {
          if (!(await visible(a)) || !(await visible(b))) return NOT_FOUND;
          if (editorState.isDirty()) return UNSAVED;
          routerRef.current.push(`/compare?a=${a}&b=${b}`);
          return { opened: [a, b] };
        },
      },
      {
        name: "highlight_citation",
        description: "表示中の回答の引用（[1] など）に対応する根拠の箇所をハイライトする",
        inputSchema: obj({ marker: str }, ["marker"]),
        annotations: { readOnlyHint: true },
        execute: async ({ marker }) => {
          let found = false;
          window.dispatchEvent(new CustomEvent("ankb:highlight-citation", { detail: { marker, respond: (v: boolean) => (found = v) } }));
          return found ? { highlighted: marker } : NOT_FOUND;
        },
      },
      {
        name: "draft_note",
        description: "新規ノートのエディタに下書きを流し込む。保存は人間が行う",
        inputSchema: obj({ title: str, body: str }, ["title"]),
        annotations: { consequentialHint: true },
        execute: async ({ title, body }) => {
          if (editorState.isDirty()) return UNSAVED;
          draftStore.put(String(title ?? ""), String(body ?? ""));
          if (pathRef.current !== "/notes/new") routerRef.current.push("/notes/new");
          return { drafted: true, saved: false };
        },
      },
      {
        name: "request_relation_approval",
        description: "置き換え・食い違いの提案の承認ダイアログを開く。確定は人間のクリックだけで行われる",
        inputSchema: obj({ relation_id: str }, ["relation_id"]),
        annotations: { consequentialHint: true },
        execute: async ({ relation_id }, options) => {
          const { status, body } = await api(`/api/relations/${encodeURIComponent(String(relation_id ?? ""))}`);
          if (status === 401 || "code" in body) return body;
          if (!body.canResolve) return { code: "FORBIDDEN", message: "この提案を承認・却下する権限がありません" };
          if (approvalRef.current) return { code: "BUSY", message: "別の承認ダイアログを表示中です" };
          return new Promise((resolve, reject) => {
            const a: Approval = { id: String(body.id), message: String(body.message), rationale: String(body.rationale ?? ""), resolve, reject };
            approvalRef.current = a;
            setApproval(a);
            options?.signal?.addEventListener("abort", () => {
              if (approvalRef.current === a) {
                approvalRef.current = null;
                setApproval(null);
              }
              reject(new DOMException("中断されました", "AbortError"));
            });
          });
        },
      },
      {
        name: "propose_relation",
        description: "2つのノートの関係（置き換え・食い違い・関連）を提案する。承認はできない",
        inputSchema: obj({ from_note_id: str, to_note_id: str, type: { type: "string", enum: ["supersedes", "contradicts", "related"] }, rationale: str }, [
          "from_note_id",
          "to_note_id",
          "type",
          "rationale",
        ]),
        execute: (args) => tool("propose_relation", args),
      },
    ];

    for (const t of tools) {
      mc.registerTool(t, { signal: controller.signal }).catch((e) => console.error(`[ankb] WebMCP ツール ${t.name} の登録に失敗:`, e));
    }

    // 別タブのログアウトで解除する（AC-129）
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AUTH_CHANNEL) : null;
    if (channel) channel.onmessage = (e) => e.data === "logout" && unregister();
    return () => {
      channel?.close();
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const decide = async (e: React.MouseEvent, decision: "confirm" | "reject" | "defer") => {
    // 人間の実際のクリックだけで確定する。スクリプトからの click() は無視する（AC-080 / AS-029）
    if (!e.nativeEvent.isTrusted) return;
    const a = approvalRef.current;
    if (!a) return;
    approvalRef.current = null;
    setApproval(null);
    if (decision === "defer") return a.resolve({ state: "deferred" });
    const res = await fetch(`/api/relations/${a.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    a.resolve(await res.json().catch(() => ({ code: "UPSTREAM_ERROR" })));
  };

  if (!approval) return null;
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label="承認の確認" className="modal">
        <p className="proposal-message">{approval.message}</p>
        {approval.rationale && <p className="proposal-rationale">理由: {approval.rationale}</p>}
        <p className="proposal-rationale">アシスタントからの確認依頼です。内容を確かめてから選んでください。</p>
        <div className="actions">
          <button type="button" onClick={(e) => decide(e, "confirm")}>
            はい
          </button>
          <button type="button" className="secondary" onClick={(e) => decide(e, "reject")}>
            いいえ
          </button>
          <button type="button" className="secondary" onClick={(e) => decide(e, "defer")}>
            後で
          </button>
        </div>
      </div>
    </div>
  );
}
