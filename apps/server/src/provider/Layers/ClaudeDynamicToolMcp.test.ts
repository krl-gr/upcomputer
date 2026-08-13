import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  createExperimentalDynamicToolRegistry,
  type ExperimentalDynamicToolInvocationContext,
} from "../../product/DynamicToolRegistry.ts";
import { makeClaudeDynamicToolMcpServers } from "./ClaudeDynamicToolMcp.ts";

const schema: { type: "object"; [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  properties: { id: { type: "string" } },
  required: ["id"],
};

async function connect(server: ReturnType<typeof makeClaudeDynamicToolMcpServers>[string]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.instance.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function resultText(result: unknown): string {
  const value = result as { readonly content?: unknown };
  const content = Array.isArray(value.content) ? value.content : [];
  const first = content[0] as { readonly type?: unknown; readonly text?: unknown } | undefined;
  return first?.type === "text" && typeof first.text === "string" ? first.text : "";
}

describe("Claude dynamic-tool MCP bridge", () => {
  it("supplies exact namespaced schemas and executes the leased registry with turn context", async () => {
    const calls: Array<{
      args: Record<string, unknown>;
      context: ExperimentalDynamicToolInvocationContext;
    }> = [];
    const registry = createExperimentalDynamicToolRegistry([
      {
        ownerId: "test.tasks",
        version: 1,
        tools: [
          {
            spec: {
              type: "function",
              namespace: "upcomputer_tasks",
              name: "task_get",
              description: "Load one task.",
              mutation: "read",
              inputSchema: schema,
            },
            execute: (args, context) => {
              calls.push({ args, context });
              return Effect.succeed({ isError: false, text: JSON.stringify({ task: args.id }) });
            },
          },
        ],
      },
    ]);
    const context: ExperimentalDynamicToolInvocationContext = {
      source: "provider",
      mutationPolicy: "allow",
      threadId: "thread-1" as never,
      turnId: "turn-1" as never,
      runtimeMode: "full-access",
      interactionMode: "default",
    };
    const servers = makeClaudeDynamicToolMcpServers({
      lease: registry.lease(),
      invocationContext: () => context,
    });
    assert.deepEqual(Object.keys(servers), ["upcomputer_tasks"]);

    const client = await connect(servers.upcomputer_tasks!);
    const listed = await client.listTools();
    assert.equal(listed.tools[0]?.name, "task_get");
    assert.equal(listed.tools[0]?.description, "Load one task.");
    assert.deepEqual(listed.tools[0]?.inputSchema, schema);

    const malformed = await client.callTool({ name: "task_get", arguments: {} });
    assert.equal(malformed.isError, true);
    assert.match(resultText(malformed), /Invalid input/u);
    assert.equal(calls.length, 0);

    const result = await client.callTool({ name: "task_get", arguments: { id: "task-1" } });
    assert.equal(result.isError, false);
    assert.equal(resultText(result), '{"task":"task-1"}');
    assert.deepEqual(calls, [{ args: { id: "task-1" }, context }]);
    await client.close();
  });

  it("fails closed for unknown calls, missing turn context, and execution failures", async () => {
    const registry = createExperimentalDynamicToolRegistry([
      {
        ownerId: "test.errors",
        version: 1,
        tools: [
          {
            spec: {
              type: "function",
              name: "task_get",
              description: "Load one task.",
              mutation: "read",
              inputSchema: schema,
            },
            execute: () => Effect.die("private failure detail"),
          },
        ],
      },
    ]);
    let context: ExperimentalDynamicToolInvocationContext | undefined;
    const failures: unknown[] = [];
    const servers = makeClaudeDynamicToolMcpServers({
      lease: registry.lease(),
      invocationContext: () => context,
      onExecutionFailure: ({ cause }) => failures.push(cause),
    });
    const client = await connect(servers.upcomputer_dynamic!);

    const unavailable = await client.callTool({ name: "task_get", arguments: { id: "x" } });
    assert.equal(unavailable.isError, true);
    assert.match(resultText(unavailable), /outside an active turn/u);

    context = { source: "provider", mutationPolicy: "deny" };
    const failed = await client.callTool({ name: "task_get", arguments: { id: "x" } });
    assert.equal(failed.isError, true);
    assert.equal(resultText(failed), "Dynamic tool 'task_get' failed.");
    assert.equal(failures.length, 1);

    const unknown = await client.callTool({ name: "stale_tool", arguments: {} });
    assert.equal(unknown.isError, true);
    assert.match(resultText(unknown), /Unknown or unadmitted/u);
    await client.close();
  });

  it("rejects namespace collisions with the unnamespaced Claude server", () => {
    const registry = createExperimentalDynamicToolRegistry([
      {
        ownerId: "test.collision",
        version: 1,
        tools: [
          {
            spec: {
              type: "function",
              name: "first_tool",
              description: "First.",
              mutation: "read",
              inputSchema: { type: "object", properties: {} },
            },
            execute: () => Effect.succeed({ isError: false, text: "first" }),
          },
          {
            spec: {
              type: "function",
              namespace: "upcomputer_dynamic",
              name: "second_tool",
              description: "Second.",
              mutation: "read",
              inputSchema: { type: "object", properties: {} },
            },
            execute: () => Effect.succeed({ isError: false, text: "second" }),
          },
        ],
      },
    ]);

    assert.throws(
      () =>
        makeClaudeDynamicToolMcpServers({
          lease: registry.lease(),
          invocationContext: () => ({ source: "provider", mutationPolicy: "deny" }),
        }),
      /collides/u,
    );
  });

  it("keeps session leases immutable and admits registry changes only in new sessions", async () => {
    const registry = createExperimentalDynamicToolRegistry([
      {
        ownerId: "test.refresh",
        version: 1,
        tools: [
          {
            spec: {
              type: "function",
              name: "task_get",
              description: "Load one task.",
              mutation: "read",
              inputSchema: schema,
            },
            execute: () => Effect.succeed({ isError: false, text: "old" }),
          },
        ],
      },
    ]);
    const context = { source: "provider", mutationPolicy: "deny" } as const;
    const oldServers = makeClaudeDynamicToolMcpServers({
      lease: registry.lease(),
      invocationContext: () => context,
    });
    registry.unregister("test.refresh");
    registry.register({
      ownerId: "test.refresh",
      version: 2,
      tools: [
        {
          spec: {
            type: "function",
            name: "agent_run_search",
            description: "Search runs.",
            mutation: "read",
            inputSchema: { type: "object", properties: {} },
          },
          execute: () => Effect.succeed({ isError: false, text: "new" }),
        },
      ],
    });
    const newServers = makeClaudeDynamicToolMcpServers({
      lease: registry.lease(),
      invocationContext: () => context,
    });

    const oldClient = await connect(oldServers.upcomputer_dynamic!);
    const newClient = await connect(newServers.upcomputer_dynamic!);
    assert.deepEqual(
      (await oldClient.listTools()).tools.map(({ name }) => name),
      ["task_get"],
    );
    assert.deepEqual(
      (await newClient.listTools()).tools.map(({ name }) => name),
      ["agent_run_search"],
    );
    await oldClient.close();
    await newClient.close();
  });
});
