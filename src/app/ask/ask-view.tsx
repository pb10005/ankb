"use client";
// @covers AC-045, AC-046, AC-076, AC-083
import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Answer, Citation } from "@/core/answer";
import { webMcpBridge } from "@/lib/webmcp/bridge";
import { askAction, type AskState } from "./actions";

/** answer 中の [n] をクリックできるボタンにする */
function AnswerText({
  answer,
  onCite,
  highlighted,
  markerRefs,
}: {
  answer: Answer;
  onCite: (c: Citation) => void;
  highlighted: string | null;
  markerRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}) {
  const byMarker = new Map(answer.citations.map((c) => [c.marker, c]));
  return (
    <div className="answer-text" data-testid="answer-text">
      {answer.answer.split("\n\n").map((para, i) => (
        <p key={i}>
          {para.split(/(\[\d+\])/).map((part, j) => {
            const c = byMarker.get(part);
            if (!c) return <Fragment key={j}>{part}</Fragment>;
            return (
              <button
                key={j}
                ref={(el) => {
                  if (el) markerRefs.current.set(part, el);
                  else markerRefs.current.delete(part);
                }}
                type="button"
                className={`marker${highlighted === part ? " marker-highlighted" : ""}`}
                aria-label={`引用${part}: ${c.title}`}
                onClick={() => onCite(c)}
              >
                {part}
              </button>
            );
          })}
        </p>
      ))}
    </div>
  );
}

export function AskView() {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, { question: "", answer: null, error: null });
  const [cited, setCited] = useState<Citation | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const markerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const answer = state.answer;

  // WebMCP の get_current_context 用に、直近の質問を画面の文脈として共有する（AC-076）
  useEffect(() => {
    webMcpBridge.setCurrentQuery(state.question || null);
    return () => webMcpBridge.setCurrentQuery(null);
  }, [state.question]);

  // WebMCP の highlight_citation ツールから、表示中の引用マーカーをハイライトできるようにする（AC-083）
  useEffect(() => {
    if (!answer) return;
    return webMcpBridge.registerCitationHandler(
      answer.citations.map((c) => c.marker),
      (marker) => {
        const c = answer.citations.find((cc) => cc.marker === marker);
        if (!c) return;
        setCited(c);
        setHighlighted(marker);
        markerRefs.current.get(marker)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setHighlighted((h) => (h === marker ? null : h)), 2000);
      },
    );
  }, [answer]);

  return (
    <>
      <form action={action} className="stack" aria-label="質問フォーム" onSubmit={() => setCited(null)}>
        <label>
          質問
          <input name="question" defaultValue={state.question} placeholder="例: 出張の宿泊費の上限はいくら？" />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "回答を作成中…" : "質問する"}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}

      {answer && (
        <section aria-label="回答" className="answer">
          <AnswerText answer={answer} onCite={setCited} highlighted={highlighted} markerRefs={markerRefs} />

          {cited && (
            <aside aria-label="根拠" className="citation-panel">
              <h3>
                {cited.marker} <Link href={`/notes/${cited.note_id}`}>{cited.title}</Link>
              </h3>
              <pre className="version-body">{cited.chunk}</pre>
            </aside>
          )}

          {answer.conflicts.length > 0 && (
            <section aria-label="食い違い" className="conflicts">
              <h3>内容が食い違っているノート</h3>
              <ul>
                {answer.conflicts.map((c) => (
                  <li key={c.note_ids.join("|")}>{c.summary || "内容が食い違っています"}</li>
                ))}
              </ul>
            </section>
          )}

          {answer.outdated_mentions.length > 0 && (
            <section aria-label="旧情報" className="outdated">
              <h3>古い情報</h3>
              <ul>
                {answer.outdated_mentions.map((o) => (
                  <li key={o.note_id}>
                    <span className="badge">旧情報</span> <Link href={`/notes/${o.note_id}`}>{o.title}</Link> — {o.note}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </>
  );
}
