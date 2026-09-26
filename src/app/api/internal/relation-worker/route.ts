// @covers AC-049, AC-059
// @assumption AS-020
// pg_cron（jobs.configure_worker）が毎分呼ぶワーカーのエンドポイント。共有秘密で保護する
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { drainRelationQueue } from "@/jobs/relation-inference";

export async function POST(request: Request) {
  const secret = process.env.ANKB_WORKER_SECRET;
  const given = request.headers.get("x-ankb-worker-secret") ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  // 長さの違う入力やマルチバイトでも例外にせず比較できるよう、ハッシュどうしを定数時間で比べる
  if (!secret || !timingSafeEqual(digest(given), digest(secret))) {
    return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  }
  const result = await drainRelationQueue();
  return NextResponse.json(result);
}
