// @covers AC-001, AC-002, AC-053, AC-072
import type { Metadata } from "next";
import "./globals.css";
import { PendingBadge } from "./relations/pending-badge";
import { WebMcpRegistrar } from "@/lib/webmcp/register";

export const metadata: Metadata = {
  title: "ankb",
  description: "散らばった断片から、今有効な答えを、根拠付きで組み立てる",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="site">
          <a href="/dashboard" className="brand">
            ankb
          </a>
          <PendingBadge />
        </header>
        {children}
        <WebMcpRegistrar />
      </body>
    </html>
  );
}
