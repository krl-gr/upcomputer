import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as JsonSchema from "effect/JsonSchema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import {
  latestActiveRun,
  McpInvocationContext,
  McpToolAccess,
  resultToolkitRegistration,
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

const taskTool = (spec: (typeof TASK_TOOL_SPECS)[number]) =>
  Tool.dynamic(spec.name, {
    description: spec.description,
    parameters: spec.inputSchema as JsonSchema.JsonSchema,
    // The handler answers with its own `CallToolResult`.
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, spec.mutation === "read")
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService);

const TaskToolkit = Toolkit.make(...TASK_TOOL_SPECS.map(taskTool));

/**
 * Reads are open to every caller. Writes need a live calling run or a client
 * approved to write; the task tools then apply their own mutation policy.
 */
const TaskToolkitHandlersLive = McpToolAccess.toLayer(
  TaskToolkit,
  Effect.gen(function* () {
    const tools = yield* TaskToolService;
    const handlers = TASK_TOOL_SPECS.map((spec) => {
      const declare = spec.mutation === "read" ? McpToolAccess.reads : McpToolAccess.writes;
      return [
        spec.name,
        declare((payload: unknown) =>
          invocationContext.pipe(
            Effect.flatMap((context) =>
              tools.call({
                name: spec.name,
                args: (payload ?? {}) as Record<string, unknown>,
                context,
              }),
            ),
            Effect.map(
              (result) =>
                new McpSchema.CallToolResult({
                  isError: result.isError,
                  content: [{ type: "text", text: result.text }],
                }),
            ),
          ),
        ),
      ] as const;
    });
    return Object.fromEntries(handlers) as McpToolAccess.Handlers<typeof TaskToolkit.tools>;
  }),
);

/** Registers every task tool on the core MCP server that v2 gives each provider session. */
export const TaskMcpToolsLive = resultToolkitRegistration(TaskToolkit, TaskToolkitHandlersLive);
