// @covers AC-072, AC-073, AC-128
// @assumption AS-030
// document.modelContext のスタブ（2026-09 の仕様ドラフト: registerTool(tool, {signal})、abort で解除、同じ name の二重登録は InvalidStateError）
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { fillLogin } from "./fixtures";
import { PASSWORD, type UserName } from "./helpers";

export const STUB = () => {
  const tools = new Map<string, { name: string; execute: (i: unknown, o: unknown) => Promise<unknown> }>();
  const log = { calls: [] as string[], errors: [] as string[] };
  const mc = {
    registerTool(tool: { name: string; execute: (i: unknown, o: unknown) => Promise<unknown> }, opts: { signal?: AbortSignal } = {}) {
      log.calls.push(tool.name);
      if (tools.has(tool.name)) {
        log.errors.push(tool.name);
        return Promise.reject(new DOMException(`duplicate ${tool.name}`, "InvalidStateError"));
      }
      tools.set(tool.name, tool);
      opts.signal?.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      });
      return Promise.resolve();
    },
    getTools() {
      return Promise.resolve([...tools.values()].map((t) => ({ name: t.name })));
    },
  };
  Object.defineProperty(document, "modelContext", { value: mc, configurable: true });
  (window as unknown as Record<string, unknown>).__webmcp = {
    log,
    tools,
    execute: (name: string, input: unknown, signal?: AbortSignal) => {
      const t = tools.get(name);
      if (!t) return Promise.reject(new Error(`no tool ${name}`));
      return t.execute(input ?? {}, { signal: signal ?? new AbortController().signal });
    },
  };
};

export async function webmcpContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript(STUB);
  const page = await context.newPage();
  return { context, page };
}

export async function loginWithWebMcp(browser: Browser, user: UserName) {
  const { context, page } = await webmcpContext(browser);
  await page.goto("/login");
  await fillLogin(page, `${user}@example.com`, PASSWORD);
  await page.waitForURL(/\/dashboard$/);
  await waitTools(page, 12);
  return { context, page };
}

export async function toolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const mc = (document as unknown as { modelContext: { getTools: () => Promise<{ name: string }[]> } }).modelContext;
    return (await mc.getTools()).map((t) => t.name);
  });
}

export async function waitTools(page: Page, n: number) {
  await page.waitForFunction((n) => (window as unknown as { __webmcp: { tools: Map<string, unknown> } }).__webmcp.tools.size === n, n);
}

export async function exec<T = Record<string, unknown>>(page: Page, name: string, input: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(
    ([n, i]) => (window as unknown as { __webmcp: { execute: (n: string, i: unknown) => Promise<unknown> } }).__webmcp.execute(n as string, i),
    [name, input] as const,
  ) as Promise<T>;
}

export const AS_027_TOOLS = [
  "search_knowledge",
  "ask",
  "get_note",
  "get_note_lineage",
  "list_pending_relations",
  "get_current_context",
  "open_note",
  "open_compare_view",
  "highlight_citation",
  "draft_note",
  "request_relation_approval",
  "propose_relation",
];
