import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import {
  latestActiveRun,
  McpInvocationContext,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { TASK_TOOL_SPECS } from "../tools/TaskToolDefinitions.ts";
import { TaskToolService } from "../tools/TaskToolServiceTag.ts";
import type { TaskToolInvocationContext } from "../tools/TaskToolTypes.ts";

/**
 * Builds the task tools' invocation context from the calling MCP session: its
 * thread, and the thread's active run, model and modes. Plan mode denies writes,
 * as the V1 fork's interaction-mode safety did. A client signed in from outside
 * a thread only reads. Tools that start or continue a run also check that the
 * caller is live and that the run stays within the caller's modes.
 */
const invocationContext = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext;
  const caller = invocation.thread;
  if (caller === undefined) {
    return { source: "mcp", mutationPolicy: "deny" } satisfies TaskToolInvocationContext;
  }
  const threads = yield* ThreadManagementService;
  const records = yield* threads.getThreadRecords(caller.threadId, ["runs"]).pipe(Effect.option);
  if (records._tag === "None") {
    return {
      source: "provider",
      mutationPolicy: "deny",
      threadId: caller.threadId,
      providerInstanceId: caller.providerInstanceId,
    } satisfies TaskToolInvocationContext;
  }
  const { thread } = records.value;
  const run = latestActiveRun(records.value);
  return {
    live:
      thread.archivedAt === null &&
      run !== undefined &&
      run.providerInstanceId === caller.providerInstanceId,
    source: "provider",
    mutationPolicy: thread.interactionMode === "plan" ? "deny" : "allow",
    threadId: caller.threadId,
    ...(run === undefined ? {} : { turnId: run.id }),
    providerInstanceId: caller.providerInstanceId,
    modelSelection: run?.modelSelection ?? thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
  } satisfies TaskToolInvocationContext;
});

/** Registers every task tool on the core MCP server that v2 gives each provider session. */
export const TaskMcpToolsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const tools = yield* TaskToolService;
    const threads = yield* ThreadManagementService;
    for (const spec of TASK_TOOL_SPECS) {
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: spec.name,
          description: spec.description,
          inputSchema: spec.inputSchema as McpSchema.Tool["inputSchema"],
          annotations: { readOnlyHint: spec.mutation === "read" },
        }),
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.withFiber((fiber) => {
            const invocation = Context.getUnsafe(fiber.context, McpInvocationContext);
            return invocationContext.pipe(
              Effect.flatMap((context) =>
                tools.call({
                  name: spec.name,
                  args: (payload ?? {}) as Record<string, unknown>,
                  context,
                }),
              ),
              Effect.provideService(McpInvocationContext, invocation),
              Effect.provideService(ThreadManagementService, threads),
              Effect.map(
                (result) =>
                  new McpSchema.CallToolResult({
                    isError: result.isError,
                    content: [{ type: "text", text: result.text }],
                  }),
              ),
            );
          }),
      });
    }
  }),
);
