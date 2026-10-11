import * as NodeModule from "node:module";
import * as NodeVM from "node:vm";
import { assert, describe, it } from "@effect/vitest";

import {
  PI_T3_MCP_EXTENSION_SOURCE,
  T3_MCP_BEARER_ENV,
  T3_MCP_URL_ENV,
  T3_PI_ORCHESTRATION_INSTRUCTIONS_ENV,
  T3_PI_USER_INSTRUCTIONS_ENV,
} from "./piT3McpExtensionSource.ts";

type RequestHook = (
  event: { payload: unknown },
  ctx: { model: { provider: string } },
) => Record<string, unknown> | undefined;

async function loadRequestHook(): Promise<RequestHook> {
  const handlers = new Map<string, RequestHook>();
  // Execute the shipped extension with MCP disabled; this path needs no Typebox.
  const source = NodeModule.stripTypeScriptTypes(
    PI_T3_MCP_EXTENSION_SOURCE.replace('import { Type } from "typebox";', "").replace(
      "export default async function",
      "async function",
    ),
  );
  await NodeVM.runInNewContext(`${source}\nt3McpExtension(pi)`, {
    process: { env: {} },
    pi: { on: (name: string, handler: RequestHook) => handlers.set(name, handler) },
  });
  const hook = handlers.get("before_provider_request");
  assert.isDefined(hook);
  return hook!;
}

describe("Pi upstream output-budget workaround", () => {
  it.each(["max_tokens", "max_completion_tokens"])(
    "caps %s without changing the conversation or tools",
    async (key) => {
      const hook = await loadRequestHook();
      const payload = {
        model: "moonshotai/kimi-k2.6",
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "read" } }],
        [key]: 231_969,
      };
      const result = hook({ payload }, { model: { provider: "openrouter" } });
      assert.equal(result?.[key], 32_768);
      assert.strictEqual(result?.messages, payload.messages);
      assert.strictEqual(result?.tools, payload.tools);
      assert.equal(result?.model, payload.model);
      assert.equal(payload[key], 231_969);
    },
  );

  it("preserves smaller budgets and other providers' payloads", async () => {
    const hook = await loadRequestHook();
    for (const payload of [{ max_tokens: 8192 }, { max_completion_tokens: 32_768 }, {}, null]) {
      assert.isUndefined(hook({ payload }, { model: { provider: "openrouter" } }));
    }
    assert.isUndefined(
      hook({ payload: { max_tokens: 231_969 } }, { model: { provider: "anthropic" } }),
    );
  });
});

type SystemPromptHook = (event: { systemPrompt: string }) => { systemPrompt: string };

async function loadSystemPromptHook(env: Record<string, string>): Promise<SystemPromptHook> {
  const handlers = new Map<string, unknown>();
  const source = NodeModule.stripTypeScriptTypes(
    PI_T3_MCP_EXTENSION_SOURCE.replace('import { Type } from "typebox";', "").replace(
      "export default async function",
      "async function",
    ),
  );
  // An unreachable endpoint: the extension still registers its prompt hook.
  await NodeVM.runInNewContext(`${source}\nt3McpExtension(pi)`, {
    process: { env },
    AbortSignal,
    fetch: () => Promise.reject(new Error("offline")),
    pi: { on: (name: string, handler: unknown) => handlers.set(name, handler) },
  });
  const hook = handlers.get("before_agent_start") as SystemPromptHook | undefined;
  assert.isDefined(hook);
  return hook!;
}

describe("Pi orchestration guidance", () => {
  const mcpEnv = {
    [T3_MCP_URL_ENV]: "http://127.0.0.1:43123/mcp",
    [T3_MCP_BEARER_ENV]: "secret-pi-token",
  };

  it("appends the orchestration block unless the session omits it", async () => {
    const withBlock = (await loadSystemPromptHook(mcpEnv))({ systemPrompt: "base" });
    assert.include(withBlock.systemPrompt, "Up.computer orchestration");

    const withoutBlock = (
      await loadSystemPromptHook({
        ...mcpEnv,
        [T3_PI_ORCHESTRATION_INSTRUCTIONS_ENV]: "omit",
        [T3_PI_USER_INSTRUCTIONS_ENV]: "# User instructions",
      })
    )({ systemPrompt: "base" });
    assert.equal(withoutBlock.systemPrompt, "base\n\n# User instructions");
  });
});
