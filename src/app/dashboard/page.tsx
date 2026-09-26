// @covers AC-002, AC-004, AC-019, AC-046, AC-128
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy をすり抜けた場合の二重防御
  if (!user) redirect("/login?next=%2Fdashboard");

  return (
    <main>
      <header className="bar">
        <h1>ダッシュボード</h1>
        <LogoutButton />
      </header>
      <p>
        ログイン中: <span data-testid="current-user-email">{user.email}</span>
      </p>
      <p>
        <Link href="/notes">ノート一覧</Link>
      </p>
      <p>
        <Link href="/ask">質問する</Link>
      </p>
      <p>
        <Link href="/search">検索する</Link>
      </p>
    </main>
  );
}
