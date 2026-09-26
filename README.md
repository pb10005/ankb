# ankb — an AI-native knowledge base

知識を体系化して整理するだけでなく、**のちのアクションに活用できる形で**保管するナレッジベース。
扱う情報はドメイン知識・計画書・決定事項。

散らばった断片から、今有効な答えを、根拠付きで組み立てる。人間（Web UI）・ブラウザ内エージェント（WebMCP）・外部エージェント（サーバMCP）の3つの入口が、同じ検索・有効性判定・権限のコアを通る。

## 仕様の出典

プロダクト要件は [`docs/instructions.md`](docs/instructions.md)（ankb 実装指示書）が原典。
実装ステップ（§10）ごとに、検証可能な受入基準へ落とした要件を `specs/` に置く。

| ステップ | 仕様 | ID | 状態 |
|---|---|---|---|
| 1 雛形 | [`specs/foundation`](specs/foundation/requirements.yaml) | FEAT-001 | frozen |
| 2 スキーマとRLS（権限） | [`specs/schema-rls`](specs/schema-rls/requirements.yaml) | FEAT-002 | frozen |
| 2 スキーマとRLS（状態遷移） | [`specs/relation-state`](specs/relation-state/requirements.yaml) | FEAT-009 | frozen |
| 3 ノートのCRUD | [`specs/note-crud`](specs/note-crud/requirements.yaml) | FEAT-003 | frozen |
| 4 検索パイプライン | [`specs/search-pipeline`](specs/search-pipeline/requirements.yaml) | FEAT-004 | frozen |
| 5 回答の契約（ask） | [`specs/answer-synthesis`](specs/answer-synthesis/requirements.yaml) | FEAT-005 | frozen |
| 5 回答UIと経緯 | [`specs/answer-experience`](specs/answer-experience/requirements.yaml) | FEAT-010 | frozen |
| 6 置き換えの推定と承認 | [`specs/relation-inference`](specs/relation-inference/requirements.yaml) | FEAT-006 | frozen |
| 7 サーバMCP | [`specs/server-mcp`](specs/server-mcp/requirements.yaml) | FEAT-007 | frozen |
| 8 WebMCP | [`specs/webmcp`](specs/webmcp/requirements.yaml) | FEAT-008 | frozen |
| 8 WebMCP（承認フロー） | [`specs/webmcp-approval`](specs/webmcp-approval/requirements.yaml) | FEAT-011 | frozen |

## Claude Code から接続する（サーバMCP）

ankb はサーバMCP（Streamable HTTP）を `/mcp` で公開する。認可は Supabase Auth の OAuth 2.1 サーバ（動的クライアント登録）で、
外部エージェントはログインしたユーザー本人の権限で動く。承認・公開範囲の変更・削除はツールに無い（人間が Web UI で行う）。

```bash
# ankb の URL（ローカル開発なら http://127.0.0.1:3000）
claude mcp add --transport http ankb http://127.0.0.1:3000/mcp
# Claude Code で /mcp を開き ankb を選ぶとブラウザで ankb のログインと「接続の許可」画面が開く。許可すると接続が完了する
```

使えるツール: `search_knowledge` / `ask` / `get_note` / `get_note_lineage` / `list_pending_relations` / `create_note` / `update_note` / `propose_relation`

本番では Supabase の Auth 設定で OAuth サーバと動的クライアント登録を有効にし、同意画面の URL を `<ankb の URL>/oauth/consent` にする
（ローカルは `supabase/config.toml` の `[auth.oauth_server]` で設定済み）。

## 開発プロセス

[conformance-kit](https://github.com/pb10005/conformance-kit) の適合性ループで開発する（規約は `CLAUDE.md`）。
要件（`specs/**/requirements.yaml`）が `frozen` になるまで実装に入らない。

```bash
npm ci
npx tsx scripts/spec-lint.ts --gate freeze   # 要件の機械検査
npm run gate                                 # マージ前ゲート
```
