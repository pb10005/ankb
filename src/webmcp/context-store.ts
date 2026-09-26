// @covers AC-075, AC-076, AC-082, AC-134
// @assumption AS-053
// 画面の文脈（開いているノート・検索クエリ）と、エディタの未保存状態・下書きの受け渡しを持つクライアント側のストア

export type PageContextValue = { note_id?: string; title?: string; query?: string };

let context: PageContextValue = {};
let dirty = false;
let draft: { id: number; title: string; body: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const pageContext = {
  get: () => context,
  set: (v: PageContextValue) => {
    context = v;
  },
  clear: (v: PageContextValue) => {
    if (context === v) context = {};
  },
};

export const editorState = {
  isDirty: () => dirty,
  setDirty: (v: boolean) => {
    dirty = v;
  },
};

export const draftStore = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => draft,
  put: (title: string, body: string) => {
    draft = { id: Date.now(), title, body };
    emit();
  },
  clear: () => {
    draft = null;
    emit();
  },
};
