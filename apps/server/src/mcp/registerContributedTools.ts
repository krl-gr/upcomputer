import type { ExperimentalInteractionModeRegistry } from "@upcomputer/shared/interactionMode";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type {
  ExperimentalMcpToolContribution,
  ExperimentalMcpToolResult,
  ExperimentalMcpToolSession,
} from "../product/McpToolContribution.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { toolFailureResult } from "./registerToolkit.ts";

function inputRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

const toCallToolResult = (result: ExperimentalMcpToolResult) =>
  new McpSchema.CallToolResult({
    isError: result.isError,
    content: result.content.map((item) =>
      item.type === "image"
        ? {
            type: "image" as const,
            data: new Uint8Array(Buffer.from(item.data, "base64")),
            mimeType: item.mimeType,
          }
        : { type: "text" as const, text: item.text },
    ),
  });

/**
 * Reads the calling session's thread on every call, so a mode change applies
 * to the next call. A thread that cannot be read denies mutations; a mode that
 * is no longer registered applies Default, like its turns.
 */
export const resolveMcpToolSession = Effect.fn("mcp.resolveToolSession")(function* (
  invocation: McpInvocationContext.McpInvocationScope,
  interactionModeRegistry: ExperimentalInteractionModeRegistry,
) {
  const projection = yield* ProjectionSnapshotQuery;
  const thread = yield* projection.getThreadShellById(invocation.threadId).pipe(
    Effect.map(Option.getOrUndefined),
    Effect.catch((cause) =>
      Effect.logWarning("Could not read the MCP session's thread", { cause }).pipe(
        Effect.as(undefined),
      ),
    ),
  );
  const interactionMode =
    thread === undefined
      ? undefined
      : interactionModeRegistry
          .snapshot()
          .find(
            (mode) => mode.id === interactionModeRegistry.effectiveModeId(thread.interactionMode),
          );
  return {
    threadId: invocation.threadId,
    providerInstanceId: invocation.providerInstanceId,
    runtimeMode: thread?.runtimeMode,
    interactionMode,
    mutationPolicy: interactionMode?.safety.mutations ?? "deny",
  } satisfies ExperimentalMcpToolSession;
});

/** Registers feature-contributed tools after the core toolkits; a name clash fails startup. */
export const makeContributedToolsLayer = (
  contributions: ReadonlyArray<ExperimentalMcpToolContribution>,
  interactionModeRegistry: ExperimentalInteractionModeRegistry,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      if (contributions.length === 0) return;
      const server = yield* McpServer.McpServer;
      const projection = yield* ProjectionSnapshotQuery;
      const registered = new Set(server.tools.map(({ tool }) => tool.name));
      for (const contribution of contributions) {
        const tools = yield* contribution.make;
        for (const tool of tools) {
          if (registered.has(tool.name)) {
            return yield* Effect.die(
              new Error(
                `MCP tool '${tool.name}' from '${contribution.ownerId}:${contribution.id}' is already registered.`,
              ),
            );
          }
          registered.add(tool.name);
          yield* server.addTool({
            tool: new McpSchema.Tool({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: {
                ...(tool.title === undefined ? {} : { title: tool.title }),
                readOnlyHint: tool.readOnly,
                destructiveHint: !tool.readOnly,
                idempotentHint: tool.readOnly,
                openWorldHint: true,
              },
            }),
            annotations: Context.empty(),
            handle: (payload) =>
              Effect.withFiber((fiber) => {
                const invocation = Context.getUnsafe(
                  fiber.context,
                  McpInvocationContext.McpInvocationContext,
                );
                return resolveMcpToolSession(invocation, interactionModeRegistry).pipe(
                  Effect.flatMap((session) => tool.execute(inputRecord(payload), session)),
                  Effect.provideService(ProjectionSnapshotQuery, projection),
                  Effect.matchCauseEffect({
                    onFailure: (cause) => toolFailureResult(tool.name, cause),
                    onSuccess: (result) => Effect.succeed(toCallToolResult(result)),
                  }),
                );
              }),
          });
        }
      }
    }),
  );
