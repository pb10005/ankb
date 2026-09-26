// @covers AC-075, AC-076, AC-082, AC-083, AC-134
// @assumption AS-031
// 画面の文脈（開いているノート・検索クエリ・選択範囲・未保存の編集）と、React 外の WebMCP ツールが
// React 側の状態（承認ダイアログ・引用ハイライト）を呼び出すための橋渡し。単一インスタンスのモジュール状態。
export type ApprovalRelation = {
  id: string;
  from_note_id: string;
  to_note_id: string;
  type: "supersedes" | "contradicts" | "related";
  rationale: string;
};

export type ApprovalOutcome = { decision: "confirmed" | "rejected" | "deferred" };

type ApprovalRequest = {
  relation: ApprovalRelation;
  resolve: (outcome: ApprovalOutcome) => void;
  reject: (err: Error) => void;
};

export const DRAFT_STORAGE_KEY = "ankb:webmcp:draft";

class WebMcpBridge {
  currentNoteId: string | null = null;
  currentQuery: string | null = null;
  hasUnsavedChanges = false;

  private approvalListeners = new Set<(req: ApprovalRequest | null) => void>();
  private citationMarkers = new Set<string>();
  private citationHandler: ((marker: string) => void) | null = null;
  private pendingApproval: ApprovalRequest | null = null;

  setUnsavedChanges(v: boolean) {
    this.hasUnsavedChanges = v;
  }

  setCurrentNoteId(id: string | null) {
    this.currentNoteId = id;
  }

  setCurrentQuery(q: string | null) {
    this.currentQuery = q;
  }

  getSelectionText(): string | undefined {
    if (typeof window === "undefined") return undefined;
    const s = window.getSelection?.()?.toString().trim();
    return s ? s : undefined;
  }

  registerCitationHandler(markers: Iterable<string>, handler: (marker: string) => void) {
    this.citationMarkers = new Set(markers);
    this.citationHandler = handler;
    return () => {
      this.citationHandler = null;
      this.citationMarkers = new Set();
    };
  }

  /** highlight_citation ツールから呼ぶ。マーカーが今の回答に存在しなければ false */
  highlightCitation(marker: string): boolean {
    if (!this.citationHandler || !this.citationMarkers.has(marker)) return false;
    this.citationHandler(marker);
    return true;
  }

  onApprovalChange(listener: (req: ApprovalRequest | null) => void): () => void {
    this.approvalListeners.add(listener);
    return () => {
      this.approvalListeners.delete(listener);
    };
  }

  private emitApproval() {
    for (const l of this.approvalListeners) l(this.pendingApproval);
  }

  /** request_relation_approval ツールから呼ぶ。人間がクリックする（あるいは後で／中断）まで解決しない Promise を返す */
  requestApproval(relation: ApprovalRelation, signal?: AbortSignal): Promise<ApprovalOutcome> {
    if (this.pendingApproval) return Promise.reject(new Error("ALREADY_OPEN"));
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      const req: ApprovalRequest = { relation, resolve, reject };
      this.pendingApproval = req;
      this.emitApproval();
      const onAbort = () => this.closeApproval(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** 人間の実クリック（『はい』『いいえ』『後で』）からだけ呼ぶこと */
  settleApproval(outcome: ApprovalOutcome) {
    const req = this.pendingApproval;
    if (!req) return;
    this.pendingApproval = null;
    this.emitApproval();
    req.resolve(outcome);
  }

  /** 中断や画面遷移でダイアログを閉じる。提案の状態は変えない */
  closeApproval(err: Error) {
    const req = this.pendingApproval;
    if (!req) return;
    this.pendingApproval = null;
    this.emitApproval();
    req.reject(err);
  }
}

export const webMcpBridge = new WebMcpBridge();
