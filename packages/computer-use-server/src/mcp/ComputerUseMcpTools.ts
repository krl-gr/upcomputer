import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import {
  McpInvocationContext,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import type { ComputerUseInteractionMode } from "../computerUse/ComputerUsePolicy.ts";
import {
  ComputerUseService,
  type ComputerUseToolResult,
} from "../computerUse/ComputerUseService.ts";
import {
  COMPUTER_USE_TOOLS,
  type ComputerUseToolDefinition,
} from "../computerUse/ComputerUseToolDefinitions.ts";

/** The calling thread's modes, read on every call. */
export interface ComputerUseSession {
  readonly interactionMode: ComputerUseInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode | undefined;
}

/** Default may observe and control; Plan only observes, as V1's read-only modes did. */
export function computerUseInteractionMode(
  mode: ProviderInteractionMode,
): ComputerUseInteractionMode {
  return mode === "plan"
    ? { displayName: "Plan", safety: { computerUse: "observe-only" } }
    : { displayName: "Default", safety: { computerUse: "allow" } };
}

/**
 * What the session itself rules out before the shared policy runs. Agents
 * cannot ask the user for approval through these tools, so every case where
 * approval would be needed is refused instead.
 */
export function computerUseSessionDenial(session: ComputerUseSession): string | undefined {
  if (session.interactionMode === undefined) {
    return "Computer use is unavailable: this thread's interaction mode could not be resolved.";
  }
  if (session.runtimeMode === "approval-required") {
    return "Computer use needs approval for every call in Supervised threads, and this agent cannot ask for it. Switch the thread to another access mode to use it.";
  }
  return undefined;
}

const APPROVAL_REQUIRED_REASON =
  "Computer Use asks for approval before control actions (Settings › Computer Use › Action approvals), and this agent cannot ask for it. Turn Action approvals off to let agents act.";

const denied = (text: string): ComputerUseToolResult => ({
  isError: true,
  content: [{ type: "text", text }],
  details: {},
});

/** Runs one tool call through the session check, the approval setting and the shared policy. */
export const callComputerUseTool = Effect.fn("ComputerUseMcpTools.call")(function* (
  tool: Pick<ComputerUseToolDefinition, "name">,
  args: Record<string, unknown>,
  session: ComputerUseSession,
) {
  const computerUse = yield* ComputerUseService;
  const interactionMode = session.interactionMode;
  const denial = computerUseSessionDenial(session);
  if (denial !== undefined || interactionMode === undefined) {
    return denied(denial ?? "Computer use is unavailable.");
  }
  return yield* Effect.tryPromise(async () => {
    const approval = await computerUse.shouldRequireApproval({
      toolName: tool.name,
      args,
      interactionMode,
    });
    if (approval.required) return denied(APPROVAL_REQUIRED_REASON);
    return computerUse.callTool({ toolName: tool.name, args, interactionMode });
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Computer-use MCP call failed", { toolName: tool.name, cause }).pipe(
        Effect.as(denied(`${tool.name} failed.`)),
      ),
    ),
  );
});

const resolveSession = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext;
  const threads = yield* ThreadManagementService;
  // A client signed in from outside a thread has no modes, so it is denied.
  const thread =
    invocation.thread === undefined
      ? null
      : yield* threads
          .getThreadShell(invocation.thread.threadId)
          .pipe(Effect.orElseSucceed(() => null));
  return {
    interactionMode:
      thread === null ? undefined : computerUseInteractionMode(thread.interactionMode),
    runtimeMode: thread?.runtimeMode,
  } satisfies ComputerUseSession;
});

/**
 * The computer_* tools on the core MCP server every provider session receives.
 * Each call reads the calling thread's current modes.
 */
export const ComputerUseMcpToolsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const computerUse = yield* ComputerUseService;
    const threads = yield* ThreadManagementService;
    for (const tool of COMPUTER_USE_TOOLS) {
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: tool.name,
          title: tool.label,
          description: tool.description,
          inputSchema: tool.inputSchema as McpSchema.Tool["inputSchema"],
          annotations: { title: tool.label, readOnlyHint: tool.mode === "observe" },
        }),
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.withFiber((fiber) => {
            const invocation = Context.getUnsafe(fiber.context, McpInvocationContext);
            return resolveSession.pipe(
              Effect.flatMap((session) =>
                callComputerUseTool(tool, (payload ?? {}) as Record<string, unknown>, session),
              ),
              Effect.map(
                (result) =>
                  new McpSchema.CallToolResult({
                    isError: result.isError,
                    content: result.content.map((item) =>
                      item.type === "text"
                        ? { type: "text" as const, text: item.text }
                        : {
                            type: "image" as const,
                            data: new Uint8Array(Buffer.from(item.data, "base64")),
                            mimeType: item.mimeType,
                          },
                    ),
                  }),
              ),
              Effect.provideService(McpInvocationContext, invocation),
              Effect.provideService(ThreadManagementService, threads),
              Effect.provideService(ComputerUseService, computerUse),
            );
          }),
      });
    }
  }),
);
