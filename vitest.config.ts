// @covers AC-005, AC-016
// @assumption AS-002
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/*.test.ts"], environment: "node" } },
      {
        // ローカル Supabase（supabase start）が必要。fixtures を投入してから直列に実行する
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/global-db.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
