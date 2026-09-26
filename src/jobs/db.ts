// @covers AC-049, AC-059
// @assumption AS-023
// @assumption AS-076
// バックグラウンドジョブ用の DB 接続。RLS を通らない特権接続なので src/jobs/ 配下からだけ使う（§5.3 / AS-042）
import pg from "pg";

let pool: pg.Pool | undefined;
export function jobPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    max: 3,
  });
  // §5.3: バックグラウンドジョブはサービスロールの権限で動く（接続ユーザーの権限のままにしない）
  pool.on("connect", (c) => void c.query("set role service_role"));
  return pool;
}
export async function closeJobPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
