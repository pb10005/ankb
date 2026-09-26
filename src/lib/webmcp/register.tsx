"use client";
// @covers AC-072, AC-073, AC-074, AC-075, AC-076, AC-079, AC-080, AC-081, AC-126, AC-128, AC-129
// @assumption AS-030, AS-031
// document.modelContext（WebMCP）に12ツールを登録し、承認ダイアログ（FEAT-011）を描画する。
// ルートレイアウトに一度だけ置く。document.modelContext が無いブラウザでは何もしない（AS-056）。
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { webMcpBridge, type ApprovalRelation } from "./bridge";
import { createTools } from "./tools";

type ModelContext = {
  registerTool: (tool: unknown, opts: { signal: AbortSignal }) => void;
};

function hasModelContext(doc: Document): doc is Document & { modelContext: ModelContext } {
  return typeof (doc as unknown as { modelContext?: unknown }).modelContext !== "undefined";
}

const RELATION_LABEL: Record<ApprovalRelation["type"], string> = {
  supersedes: "置き換える",
  contradicts: "矛盾する",
  related: "関連する",
};

export function WebMcpRegistrar() {
  const router = useRouter();
  const pathname = usePathname();
  const [approval, setApproval] = useState<{ relation: ApprovalRelation } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 画面の文脈: 開いているノート（/notes/:id。edit・history・new は含めない）
  useEffect(() => {
    const m = pathname.match(/^\/notes\/([^/]+)$/);
    webMcpBridge.setCurrentNoteId(m ? m[1] : null);
    if (!pathname.startsWith("/ask")) webMcpBridge.setCurrentQuery(null);
  }, [pathname]);

  // 画面遷移中は承認ダイアログを閉じる（提案の状態は変えない。AC-126 (c)）
  const firstPathname = useRef(pathname);
  useEffect(() => {
    if (pathname !== firstPathname.current) {
      webMcpBridge.closeApproval(new DOMException("navigated", "AbortError"));
    }
  }, [pathname]);

  useEffect(
    () =>
      webMcpBridge.onApprovalChange((req) => {
        setApproval(req ? { relation: req.relation } : null);
        setApprovalError(null);
      }),
    [],
  );

  useEffect(() => {
    if (typeof document === "undefined" || !hasModelContext(document)) return; // AS-056: 非対応ブラウザでは何もしない
    const modelContext = document.modelContext;
    const supabase = createClient();
    // controller は同期的に作る: cleanup（Strict Mode の二重実行を含む）が getUser() 解決前でも
    // 確実に中断できるようにするため（先に abort しておけば、後から解決した register() は登録しない）
    const controller = new AbortController();

    const register = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || controller.signal.aborted) return; // AC-072: 未ログインでは登録しない
      const tools = createTools(router);
      for (const tool of tools) {
        if (controller.signal.aborted) break;
        try {
          modelContext.registerTool(tool, { signal: controller.signal });
        } catch (e) {
          console.error("[ankb][webmcp] registerTool failed:", tool.name, e);
        }
      }
    };
    void register();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        controller.abort(); // AC-074 / AC-129: ログアウトしたら解除
        webMcpBridge.closeApproval(new DOMException("signed-out", "AbortError"));
      }
    });

    return () => {
      controller.abort();
      subscription.unsubscribe();
    };
    // pathname の変化では再登録しない: registerTool は一度だけでよい（AC-128, クライアント側遷移をまたいで維持する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!approval) return null;

  const handleDecision = async (decision: "confirm" | "reject", e: React.MouseEvent) => {
    // CDP 経由などの合成クリック（isTrusted=false）は拒否する（AC-080 / AS-029）
    if (!e.isTrusted) return;
    setPending(true);
    setApprovalError(null);
    try {
      const res = await fetch(`/api/relations/${encodeURIComponent(approval.relation.id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setApprovalError((body as { message?: string }).message ?? "処理に失敗しました");
        return;
      }
      webMcpBridge.settleApproval({ decision: decision === "confirm" ? "confirmed" : "rejected" });
    } finally {
      setPending(false);
    }
  };

  const handleDefer = (e: React.MouseEvent) => {
    if (!e.isTrusted) return;
    webMcpBridge.settleApproval({ decision: "deferred" });
  };

  return (
    <div className="webmcp-approval-overlay" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="webmcp-approval-title" className="webmcp-approval-dialog">
        <h2 id="webmcp-approval-title">エージェントからの提案</h2>
        <p>
          このノートは、もう一方のノートを<strong>{RELATION_LABEL[approval.relation.type]}</strong>という提案です。
        </p>
        {approval.relation.rationale && <p className="webmcp-approval-rationale">{approval.relation.rationale}</p>}
        {approvalError && (
          <p role="alert" className="error">
            {approvalError}
          </p>
        )}
        <div className="webmcp-approval-actions">
          <button type="button" disabled={pending} onClick={(e) => handleDecision("confirm", e)}>
            承認する
          </button>
          <button type="button" className="secondary" disabled={pending} onClick={(e) => handleDecision("reject", e)}>
            却下する
          </button>
          <button type="button" className="secondary" disabled={pending} onClick={handleDefer}>
            後で
          </button>
        </div>
      </div>
    </div>
  );
}
