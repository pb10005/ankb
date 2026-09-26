"use client";
// @covers AC-045, AC-046, AC-083
import { Fragment, useActionState, useEffect, useState } from "react";
import Link from "next/link";
import type { Answer, Citation } from "@/core/answer";
import { askAction, type AskState } from "./actions";

/** answer 中の [n] をクリックできるボタンにする */
function AnswerText({ answer, onCite }: { answer: Answer; onCite: (c: Citation) => void }) {
  const byMarker = new Map(answer.citations.map((c) => [c.marker, c]));
  return (
    <div className="answer-text" data-testid="answer-text">
      {answer.answer.split("\n\n").map((para, i) => (
        <p key={i}>
          {para.split(/(\[\d+\])/).map((part, j) => {
            const c = byMarker.get(part);
            return c ? (
              <button key={j} type="button" className="marker" aria-label={`引用${part}: ${c.title}`} onClick={() => onCite(c)}>
                {part}
              </button>
            ) : (
              <Fragment key={j}>{part}</Fragment>
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
  const [highlighted, setHighlighted] = useState(false);
  const answer = state.answer;
  // エージェントの highlight_citation（WebMCP）
  useEffect(() => {
    const onHighlight = (e: Event) => {
      const { marker, respond } = (e as CustomEvent<{ marker: string; respond: (v: boolean) => void }>).detail;
      const c = answer?.citations.find((x) => x.marker === marker);
      if (!c) return respond(false);
      setCited(c);
      setHighlighted(true);
      respond(true);
    };
    window.addEventListener("ankb:highlight-citation", onHighlight);
    return () => window.removeEventListener("ankb:highlight-citation", onHighlight);
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
          <AnswerText
            answer={answer}
            onCite={(c) => {
              setCited(c);
              setHighlighted(false);
            }}
          />

          {cited && (
            <aside aria-label="根拠" className={highlighted ? "citation-panel highlighted" : "citation-panel"} data-highlighted={highlighted ? "true" : undefined}>
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
