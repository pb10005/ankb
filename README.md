# ankb — an AI-native knowledge base

知識を体系化して整理するだけでなく、**のちのアクションに活用できる形で**保管するナレッジベース。
扱う情報はドメイン知識・計画書・決定事項。

- 各アイテムは本文に加えて「次アクション」「見直し期日」「根拠」「アイテム間の関係（supersedes / depends_on ほか）」を構造化フィールドとして持つ
- エージェントは「未完了アクションの一覧」「見直し期限を過ぎた決定」「この決定を置き換えた新しい決定」を問い合わせだけで引き出せる

## アーキテクチャ

```
 ブラウザ内エージェント ──WebMCP (navigator.modelContext)──▶ フロントエンド (FEAT-002)
                                                              │ fetch: JSON-RPC
 Claude などのMCPクライアント ──Streamable HTTP (POST /mcp)──▶ サーバサイドMCP (FEAT-001) ──▶ SQLite (FTS5)
```

| 層 | 仕様 | 状態 |
|---|---|---|
| バックエンド（サーバサイドMCP） | [`specs/kb-core/requirements.yaml`](specs/kb-core/requirements.yaml) | draft |
| フロントエンド（WebMCP） | [`specs/webmcp-ui/requirements.yaml`](specs/webmcp-ui/requirements.yaml) | draft |

## 開発プロセス

[conformance-kit](https://github.com/pb10005/conformance-kit) の適合性ループで開発する（規約は `CLAUDE.md`）。
要件（`specs/**/requirements.yaml`）が `frozen` になるまで実装に入らない。

```bash
npm ci
npx tsx scripts/spec-lint.ts --gate freeze   # 要件の機械検査
npm run gate                                 # マージ前ゲート
```
