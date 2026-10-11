import type { ThreadId } from "@t3tools/contracts";
import type { ToolCallHint } from "@t3tools/provider-core/server/mcpSession";
import * as Effect from "effect/Effect";

export type { ToolCallHint };

/** The hints for a thread's agent; empty for none. */
export type ToolCallHintsResolver = (
  threadId: ThreadId,
) => Effect.Effect<ReadonlyArray<ToolCallHint>>;

let toolCallHintsResolver: ToolCallHintsResolver | undefined;

/** Registers the resolver for the lifetime of the calling scope. */
export const registerToolCallHintsResolver = (resolver: ToolCallHintsResolver) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      toolCallHintsResolver = resolver;
    }),
    () =>
      Effect.sync(() => {
        if (toolCallHintsResolver === resolver) toolCallHintsResolver = undefined;
      }),
  );

/** Read when a thread's MCP session is prepared; a failing resolver gives no hints. */
export const toolCallHintsFor = (threadId: ThreadId): Effect.Effect<ReadonlyArray<ToolCallHint>> =>
  toolCallHintsResolver === undefined
    ? Effect.succeed([])
    : toolCallHintsResolver(threadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not resolve tool call hints; leaving them out.", {
            threadId,
            cause,
          }).pipe(Effect.as([])),
        ),
      );

export const sameToolCallHints = (
  a: ReadonlyArray<ToolCallHint>,
  b: ReadonlyArray<ToolCallHint>,
): boolean =>
  a.length === b.length &&
  a.every((hint, index) => hint.name === b[index]?.name && hint.args === b[index]?.args);
