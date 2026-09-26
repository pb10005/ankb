// @covers AC-045, AC-046
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { AskView } from "./ask-view";

export default async function AskPage() {
  await requireUser("/ask");
  return (
    <main>
      <p>
        <Link href="/dashboard">← ダッシュボード</Link>
      </p>
      <h1>質問する</h1>
      <AskView />
    </main>
  );
}
