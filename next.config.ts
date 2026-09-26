// @covers AC-001, AC-046
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E は 127.0.0.1 でアクセスする。dev サーバはこれを許可しないと JS が読み込まれず画面が動かない
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
