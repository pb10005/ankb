// @covers AC-018, AC-020, AC-024, AC-025, AC-026, AC-131, AC-138, AC-049, AC-052, AC-112, AC-075, AC-084
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { canEdit, CONFLICT_MESSAGE, getNote, listColleagues, listShares } from "@/core/notes";
import { PERMISSION_LABEL, STATUS_LABEL, VISIBILITY_LABEL, type Visibility } from "@/core/labels";
import { requireUser } from "@/lib/session";
import { proposalsForNote } from "@/core/relations";
import { ProposalBanner } from "../../relations/proposal-banner";
import { PageContext } from "@/webmcp/page-context";
import { archiveNoteAction, publishNoteAction, setShareAction, setVisibilityAction } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  conflict: CONFLICT_MESSAGE,
  forbidden: "この操作を行う権限がありません",
  validation_error: "入力内容を確認してください",
  not_found: "ノートが見つかりません",
};

export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await requireUser(`/notes/${id}`);
  const res = await getNote(supabase, id);
  // 閲覧できないノートは存在しないノートと同じ 404（AS-051）
  if (!res?.ok) notFound();
  const note = res.value;
  const editable = await canEdit(supabase, id);
  const isOwner = note.owner_id === user.id;
  const shares = isOwner ? await listShares(supabase, id) : [];
  const proposals = await proposalsForNote(supabase, id);
  const colleagues = isOwner ? (await listColleagues(supabase, note.workspace_id)).filter((c) => c.user_id !== user.id) : [];

  return (
    <main>
      <p>
        <Link href="/notes">← ノート一覧</Link>
      </p>
      <PageContext note_id={note.id} title={note.title} />
      <h1>{note.title}</h1>
      {error && ERROR_MESSAGES[error] && (
        <p role="alert" className="error">
          {ERROR_MESSAGES[error]}
        </p>
      )}
      <ProposalBanner
        noteId={id}
        proposals={proposals.map((p) => ({ id: p.id, message: p.message, rationale: p.rationale, otherId: p.other.id, canResolve: p.canResolve }))}
      />
      <p className="badges">
        {note.status !== "active" && <span className="badge">{STATUS_LABEL[note.status]}</span>}
        <span className="badge">{VISIBILITY_LABEL[note.visibility]}</span>
      </p>

      <article className="note-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
      </article>

      <nav className="actions" aria-label="ノートの操作">
        <Link href={`/notes/${id}/history`}>版履歴</Link>
        {editable && (
          <Link href={`/notes/${id}/edit`} className="button">
            編集
          </Link>
        )}
        {editable && note.status === "draft" && (
          <form action={publishNoteAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={note.version} />
            <button type="submit">公開する（有効にする）</button>
          </form>
        )}
        {editable && note.status === "active" && (
          <form action={archiveNoteAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={note.version} />
            <button type="submit" className="secondary">
              アーカイブ
            </button>
          </form>
        )}
      </nav>

      {isOwner && (
        <section aria-label="公開範囲と共有">
          <h2>公開範囲と共有</h2>
          <form action={setVisibilityAction} className="inline">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={note.version} />
            <label>
              公開範囲
              <select name="visibility" defaultValue={note.visibility} aria-label="公開範囲">
                {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">公開範囲を変更</button>
          </form>

          <ul className="share-list" aria-label="共有">
            {colleagues.map((c) => {
              const current = shares.find((s) => s.user_id === c.user_id)?.permission ?? "none";
              return (
                <li key={c.user_id}>
                  <form action={setShareAction} className="inline">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="user_id" value={c.user_id} />
                    <label>
                      {c.display_name}
                      <select name="permission" defaultValue={current} aria-label={`${c.display_name}との共有`}>
                        <option value="none">共有しない</option>
                        <option value="view">{PERMISSION_LABEL.view}</option>
                        <option value="edit">{PERMISSION_LABEL.edit}</option>
                      </select>
                    </label>
                    <button type="submit" className="secondary" aria-label={`${c.display_name}との共有を保存`}>
                      保存
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
