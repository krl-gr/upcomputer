import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import {
  McpInvocationContext,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskToolService } from "../tools/TaskToolServiceTag.ts";
import { TaskMcpToolsLive } from "./TaskMcpTools.ts";

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "any-provider", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "any-provider", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const calls: Array<string> = [];
const layer = TaskMcpToolsLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mock(ThreadManagementService)({
      // An unknown thread: the task tools then only read.
      getThreadRecords: () => Effect.fail(new Error("unknown thread")) as never,
    }),
  ),
  Layer.provide(
    Layer.mock(TaskToolService)({
      call: ({ name }) => {
        calls.push(name);
        return Effect.succeed({ isError: false, text: `${name} ok` });
      },
    }),
  ),
);

// Effect 4.1.3 JSON-encodes tool results, so a tool without a declared success
// schema failed every call with "Expected JSON value" before reaching the user.
it.effect("a task tool call through the MCP server returns the tool's result", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({ name: "task_context", arguments: {} }).pipe(
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        requestNamespace: "session-1",
        thread: {
          threadId: ThreadId.make("thread-1"),
          providerSessionId: "session-1",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set<never>(),
        issuedAt: 0,
      }),
      Effect.provideService(McpSchema.McpServerClient, mcpClient),
    );
    assert.isFalse(result.isError);
    assert.deepStrictEqual(
      result.content.map((part) => (part.type === "text" ? part.text : "")),
      ["task_context ok"],
    );
    assert.deepStrictEqual(calls, ["task_context"]);
  }).pipe(Effect.provide(layer)),
);
