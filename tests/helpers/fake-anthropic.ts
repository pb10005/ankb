// @covers AC-037, AC-108
// ClaudeSynthesizer に渡す偽の Anthropic クライアント。リクエストを記録し、指定した構造化出力（JSON 文字列）を返す。
// 合成器の組み立て・解析コードは本物を通る。
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeSynthesizer, type Claim, type SynthesisInput } from "../../src/core/synthesizer";

export type FakeReply = { claims: Claim[]; not_found: boolean } | ((input: string) => { claims: Claim[]; not_found: boolean });

export function fakeSynthesizer(reply: FakeReply | Error) {
  const requests: unknown[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          requests.push(params);
          if (reply instanceof Error) throw reply;
          const content = (params as { messages: { content: string }[] }).messages[0].content;
          const out = typeof reply === "function" ? reply(content) : reply;
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] };
        },
      },
    },
  } as unknown as Pick<Anthropic, "beta">;
  return { synthesizer: new ClaudeSynthesizer(client, "claude-opus-5"), requests };
}

export type { SynthesisInput };
