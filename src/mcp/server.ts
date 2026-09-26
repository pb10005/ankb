// @covers AC-060, AC-062, AC-063, AC-064, AC-066, AC-067, AC-068, AC-070, AC-119, AC-123, AC-124
// @assumption AS-025
// @assumption AS-026
// @assumption AS-050
// サーバMCP のツール（指示書 §7.1）。外部エージェントはユーザー本人のトークン（RLS）で動き、
// 検索・回答・ノート操作は Web UI と同じコア関数を通る（§1.3）。承認・公開範囲の変更・削除はツールとして提供しない。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { searchKnowledge } from "@/core/search";
import { ask } from "@/core/answer";
import { UpstreamError, type Synthesizer } from "@/core/synthesizer";
import { createNote, getNote, listMyWorkspaces, updateNote } from "@/core/notes";
import { pendingProposals } from "@/core/relations";
import { noteLineage, noteRelationsSummary } from "@/core/lineage";
import { consumeAskQuota } from "@/core/usage";

type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UPSTREAM_ERROR" | "RATE_LIMITED";

const ok = (value: object): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const err = (code: ErrorCode, message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] });

// ── 出力スキーマ（§7.3） ──
const Hit = z.object({
  note_id: z.string(),
  title: z.string(),
  chunk: z.string(),
  status: z.enum(["active", "superseded"]),
  updated_at: z.string(),
  effective_from: z.string().optional(),
  possibly_outdated: z.boolean(),
  superseded_by: z.string().optional(),
  score: z.number(),
});
const Conflict = z.object({ note_ids: z.array(z.string()), summary: z.string(), relation_state: z.enum(["proposed", "confirmed"]) });
export const SearchResultSchema = z.object({
  hits: z.array(Hit),
  superseded_context: z.array(Hit),
  conflicts: z.array(Conflict),
  synthesis_guidelines: z.string(),
});
export const AnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ marker: z.string(), note_id: z.string(), title: z.string(), chunk: z.string() })),
  outdated_mentions: z.array(z.object({ note_id: z.string(), title: z.string(), note: z.string() })),
  conflicts: z.array(Conflict),
  not_found: z.boolean(),
  format: z.enum(["standard", "timeline"]),
});
const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["draft", "active", "superseded", "archived"]),
  visibility: z.enum(["private", "shared", "workspace"]),
  effective_from: z.string().nullable(),
  superseded_by: z.string().nullable(),
  version: z.number(),
  updated_at: z.string(),
  possibly_outdated: z.boolean(),
  conflicts: z.array(Conflict),
});
const LineageSchema = z.object({
  lineage: z.array(z.object({ note_id: z.string(), title: z.string(), status: z.string(), date: z.string(), superseded_by: z.string().nullable() })),
});
const ProposalsSchema = z.object({
  relations: z.array(
    z.object({
      id: z.string(),
      from_note_id: z.string(),
      from_title: z.string(),
      to_note_id: z.string(),
      to_title: z.string(),
      type: z.enum(["supersedes", "contradicts", "related"]),
      rationale: z.string(),
      confidence: z.number().nullable(),
    }),
  ),
});
const RelationSchema = z.object({ id: z.string(), state: z.literal("proposed"), proposed_by: z.literal("agent") });

export const TOOL_NAMES = [
  "search_knowledge",
  "ask",
  "get_note",
  "get_note_lineage",
  "list_pending_relations",
  "create_note",
  "update_note",
  "propose_relation",
] as const;

async function noteView(client: SupabaseClient, id: string) {
  const res = await getNote(client, id);
  if (!res?.ok) return null;
  const n = res.value;
  const rel = await noteRelationsSummary(client, id);
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    status: n.status,
    visibility: n.visibility,
    effective_from: n.effective_from,
    superseded_by: n.superseded_by,
    version: n.version,
    updated_at: n.updated_at,
    ...rel,
  };
}

export function createAnkbMcpServer(client: SupabaseClient, deps: { synthesizer?: Synthesizer } = {}): McpServer {
  const server = new McpServer({ name: "ankb", version: "0.1.0" });
  const readOnly = { readOnlyHint: true } as const;

  server.registerTool(
    "search_knowledge",
    {
      description: "ナレッジを検索し、今有効なノートのチャンク（hits）・置き換え済みの旧情報（superseded_context）・食い違い（conflicts）と、回答を組み立てるときの契約（synthesis_guidelines）を返す",
      inputSchema: { query: z.string().min(1).max(500) },
      outputSchema: SearchResultSchema.shape,
      annotations: readOnly,
    },
    async ({ query }) => ok(await searchKnowledge(client, query)),
  );

  server.registerTool(
    "ask",
    {
      description: "質問にサーバ側で回答を合成する。すべての主張に根拠ノートの引用が付き、旧情報・食い違いは区別して示す",
      inputSchema: { question: z.string().min(1).max(500) },
      outputSchema: AnswerSchema.shape,
      annotations: readOnly,
    },
    async ({ question }) => {
      if (!(await consumeAskQuota(client))) return err("RATE_LIMITED", "質問の回数の上限に達しました。時間をおいてください");
      try {
        return ok(await ask(client, question, deps.synthesizer ? { synthesizer: deps.synthesizer } : {}));
      } catch (e) {
        if (e instanceof UpstreamError) return err("UPSTREAM_ERROR", "回答を作成できませんでした");
        throw e;
      }
    },
  );

  server.registerTool(
    "get_note",
    {
      description: "ノートの本文とメタデータ（有効性の状態・更新の可能性・食い違い）を返す",
      inputSchema: { note_id: z.string() },
      outputSchema: NoteSchema.shape,
      annotations: readOnly,
    },
    async ({ note_id }) => {
      const v = await noteView(client, note_id);
      return v ? ok(v) : err("NOT_FOUND", "ノートが見つかりません");
    },
  );

  server.registerTool(
    "get_note_lineage",
    {
      description: "置き換えの連鎖を時系列（古い順）で返す。閲覧できないノートは含まない",
      inputSchema: { note_id: z.string() },
      outputSchema: LineageSchema.shape,
      annotations: readOnly,
    },
    async ({ note_id }) => {
      const v = await getNote(client, note_id);
      if (!v?.ok) return err("NOT_FOUND", "ノートが見つかりません");
      const lineage = await noteLineage(client, note_id);
      return lineage ? ok({ lineage: lineage.map((l) => ({ ...l, superseded_by: l.superseded_by ?? null })) }) : err("NOT_FOUND", "ノートが見つかりません");
    },
  );

  server.registerTool(
    "list_pending_relations",
    {
      description: "自分が承認・却下できる（両方のノートを編集できる）未承認の提案を返す。承認は人間が Web UI で行う",
      inputSchema: {},
      outputSchema: ProposalsSchema.shape,
      annotations: readOnly,
    },
    async () => {
      const rows = await pendingProposals(client);
      return ok({
        relations: rows.map((r) => ({
          id: r.id,
          from_note_id: r.from_note_id,
          from_title: r.from_title,
          to_note_id: r.to_note_id,
          to_title: r.to_title,
          type: r.type,
          rationale: r.rationale,
          confidence: r.confidence,
        })),
      });
    },
  );

  server.registerTool(
    "create_note",
    {
      description: "ノートを作成する。公開範囲は常に非公開（private）。status は draft（既定）または active",
      inputSchema: {
        title: z.string(),
        body: z.string().default(""),
        status: z.enum(["draft", "active"]).optional(),
        workspace_id: z.string().optional(),
        // 公開範囲は受け付けない（AS-050）。指定されたら VALIDATION_ERROR
        visibility: z.unknown().optional(),
      },
      outputSchema: NoteSchema.shape,
    },
    async ({ title, body, status, workspace_id, visibility }) => {
      if (visibility !== undefined) return err("VALIDATION_ERROR", "create_note では公開範囲を指定できません（人間が Web UI で設定します）");
      const workspaces = await listMyWorkspaces(client);
      const ws = workspace_id ?? workspaces[0]?.id;
      if (!ws || !workspaces.some((w) => w.id === ws)) return err("VALIDATION_ERROR", "workspace_id を確認してください");
      const created = await createNote(client, { workspace_id: ws, title, body });
      if (!created.ok) return err(created.code, created.message);
      if (status === "active") {
        const up = await updateNote(client, created.value.id, { status: "active", expected_version: created.value.version });
        if (!up.ok) return err(up.code, up.message);
      }
      return ok((await noteView(client, created.value.id))!);
    },
  );

  server.registerTool(
    "update_note",
    {
      description: "ノートを更新する（編集権限が必要）。変更できるのは title・body・effective_from と、status の draft→active のみ",
      inputSchema: {
        note_id: z.string(),
        expected_version: z.number().int(),
        title: z.string().optional(),
        body: z.string().optional(),
        effective_from: z.string().nullable().optional(),
        status: z.string().optional(),
        visibility: z.unknown().optional(),
      },
      outputSchema: NoteSchema.shape,
    },
    async ({ note_id, expected_version, title, body, effective_from, status, visibility }) => {
      if (visibility !== undefined) return err("VALIDATION_ERROR", "公開範囲は人間が Web UI で変更します");
      if (status !== undefined && status !== "active") return err("VALIDATION_ERROR", "status は active（下書きの公開）だけを指定できます");
      const patch: Record<string, unknown> = { expected_version };
      if (title !== undefined) patch.title = title;
      if (body !== undefined) patch.body = body;
      if (effective_from !== undefined) patch.effective_from = effective_from;
      if (status !== undefined) {
        const cur = await getNote(client, note_id);
        if (cur?.ok && cur.value.status !== "draft") return err("VALIDATION_ERROR", "status を active にできるのは下書きだけです");
        patch.status = status;
      }
      const res = await updateNote(client, note_id, patch);
      if (!res.ok) return err(res.code, res.message);
      return ok((await noteView(client, note_id))!);
    },
  );

  server.registerTool(
    "propose_relation",
    {
      description: "2つのノートの関係（置き換え・食い違い・関連）を提案する。承認はできない（人間が Web UI で行う）",
      inputSchema: {
        from_note_id: z.string(),
        to_note_id: z.string(),
        type: z.enum(["supersedes", "contradicts", "related"]),
        rationale: z.string().min(1).max(2000),
      },
      outputSchema: RelationSchema.shape,
    },
    async ({ from_note_id, to_note_id, type, rationale }) => {
      const [a, b] = await Promise.all([getNote(client, from_note_id), getNote(client, to_note_id)]);
      if (!a?.ok || !b?.ok) return err("NOT_FOUND", "ノートが見つかりません");
      if (from_note_id === to_note_id) return err("VALIDATION_ERROR", "同じノートどうしは提案できません");
      const id = crypto.randomUUID();
      const { error } = await client
        .from("note_relation")
        .insert({ id, from_note_id, to_note_id, type, proposed_by: "agent", rationale } as Record<string, unknown>);
      if (error) return err("VALIDATION_ERROR", "提案を作成できませんでした");
      return ok({ id, state: "proposed", proposed_by: "agent" });
    },
  );

  return server;
}
