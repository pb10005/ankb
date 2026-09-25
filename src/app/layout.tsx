// @covers AC-001, AC-002
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ankb",
  description: "散らばった断片から、今有効な答えを、根拠付きで組み立てる",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
