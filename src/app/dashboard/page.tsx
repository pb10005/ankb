// @covers AC-002, AC-004
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";

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
        <form action={logout}>
          <button type="submit" className="secondary">
            ログアウト
          </button>
        </form>
      </header>
      <p>
        ログイン中: <span data-testid="current-user-email">{user.email}</span>
      </p>
    </main>
  );
}
