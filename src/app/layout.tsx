// @covers AC-001, AC-002, AC-053, AC-072, AC-073, AC-074, AC-128
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { PendingBadge } from "./relations/pending-badge";
import { WebMcpProvider } from "@/webmcp/provider";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "ankb",
  description: "散らばった断片から、今有効な答えを、根拠付きで組み立てる",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <html lang="ja">
      <body>
        <header className="site">
          <Link href="/dashboard" className="brand">
            ankb
          </Link>
          <PendingBadge />
        </header>
        {children}
        {user && <WebMcpProvider />}
      </body>
    </html>
  );
}
