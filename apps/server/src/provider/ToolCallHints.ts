import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * A `t3-code` MCP tool a product feature wants a thread's agent to call
 * without looking it up first, with a short argument shape such as
 * `{id, status?}`. Codex code mode keeps MCP tools out of the model's context,
 * so without a hint the agent spends a model call on an ALL_TOOLS lookup
 * before it can call a tool.
 */
export interface ToolCallHint {
  readonly name: string;
  readonly args: string;
}

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
