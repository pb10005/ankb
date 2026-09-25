// @covers AC-005
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // scripts/ は conformance-kit から配置したファイル。ankb の lint 対象外とする
  globalIgnores([".next/**", "node_modules/**", "scripts/**", "test-results/**", "playwright-report/**", "next-env.d.ts"]),
]);
