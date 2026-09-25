# ankb — an AI-native knowledge base

知識を体系化して整理するだけでなく、**のちのアクションに活用できる形で**保管するナレッジベース。
扱う情報はドメイン知識・計画書・決定事項。

散らばった断片から、今有効な答えを、根拠付きで組み立てる。人間（Web UI）・ブラウザ内エージェント（WebMCP）・外部エージェント（サーバMCP）の3つの入口が、同じ検索・有効性判定・権限のコアを通る。

## 仕様の出典

プロダクト要件は [`docs/instructions.md`](docs/instructions.md)（ankb 実装指示書）が原典。
実装ステップ（§10）ごとに、検証可能な受入基準へ落とした要件を `specs/` に置く。

| ステップ | 仕様 | 状態 |
|---|---|---|
| 1 雛形 | [`specs/foundation`](specs/foundation/requirements.yaml) | draft |
| 2 スキーマとRLS | [`specs/schema-rls`](specs/schema-rls/requirements.yaml) | draft |
| 3 ノートのCRUD | [`specs/note-crud`](specs/note-crud/requirements.yaml) | draft |
| 4 検索パイプライン | [`specs/search-pipeline`](specs/search-pipeline/requirements.yaml) | draft |
| 5 回答の合成 | [`specs/answer-synthesis`](specs/answer-synthesis/requirements.yaml) | draft |
| 6 置き換えの推定と承認 | [`specs/relation-inference`](specs/relation-inference/requirements.yaml) | draft |
| 7 サーバMCP | [`specs/server-mcp`](specs/server-mcp/requirements.yaml) | draft |
| 8 WebMCP | [`specs/webmcp`](specs/webmcp/requirements.yaml) | draft |

## 開発プロセス

[conformance-kit](https://github.com/pb10005/conformance-kit) の適合性ループで開発する（規約は `CLAUDE.md`）。
要件（`specs/**/requirements.yaml`）が `frozen` になるまで実装に入らない。

```bash
npm ci
npx tsx scripts/spec-lint.ts --gate freeze   # 要件の機械検査
npm run gate                                 # マージ前ゲート
```
