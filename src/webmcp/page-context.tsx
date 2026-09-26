"use client";
// @covers AC-075, AC-076
import { useEffect } from "react";
import { pageContext, type PageContextValue } from "./context-store";

/** 表示中の画面の文脈を登録する（エージェントの get_current_context が読む） */
export function PageContext(props: PageContextValue) {
  const { note_id, title, query } = props;
  useEffect(() => {
    const v = { note_id, title, query };
    pageContext.set(v);
    return () => pageContext.clear(v);
  }, [note_id, title, query]);
  return null;
}
