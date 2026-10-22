import type {
  MessageId,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  OrchestrationV2TurnItem,
  ProjectId,
  ProviderInteractionMode,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export interface TurnContextInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly interactionMode?: ProviderInteractionMode;
  /** The marker of the context the current native conversation already holds. */
  readonly deliveredMarker?: string;
}
export interface TurnContext {
  readonly text: string;
  /** Recorded with the prompt and offered back as `deliveredMarker` while it stays in context. */
  readonly marker?: string;
  /**
   * What changed since `deliveredMarker`, sent instead of `text` when the native conversation
   * is unchanged; empty when nothing changed. Absent means the full `text` is needed.
   */
  readonly update?: string;
}
type Resolver = (input: TurnContextInput) => Effect.Effect<TurnContext, unknown>;
let resolver: Resolver | undefined;

export const registerTurnContextResolver = (value: Resolver) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      resolver = value;
    }),
    () =>
      Effect.sync(() => {
        if (resolver === value) resolver = undefined;
      }),
  );

// Unlike optional tool hints, a failed context/access read must stop the turn.
export const turnContextFor = (input: TurnContextInput): Effect.Effect<TurnContext, unknown> =>
  resolver === undefined ? Effect.succeed({ text: "" }) : resolver(input);

/**
 * The marker of the latest turn context this native conversation accepted. A compaction in or
 * after that run may have summarized it away, and a rolled-back run left native history, so
 * either sends the full context again.
 */
export function deliveredTurnContextMarker(input: {
  readonly providerThreadId: ProviderThreadId;
  readonly nativeThreadId: string | undefined;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal" | "status">>;
  readonly attempts: ReadonlyArray<
    Pick<
      OrchestrationV2RunAttempt,
      | "id"
      | "runId"
      | "attemptOrdinal"
      | "providerThreadId"
      | "nativeThreadId"
      | "turnContextMarker"
    >
  >;
  readonly providerTurns: ReadonlyArray<Pick<OrchestrationV2ProviderTurn, "runAttemptId">>;
  readonly turnItems: ReadonlyArray<
    Pick<OrchestrationV2TurnItem, "type" | "runId" | "providerThreadId">
  >;
}): string | undefined {
  if (input.nativeThreadId === undefined) return undefined;
  const runs = new Map(input.runs.map((run) => [run.id, run]));
  const accepted = new Set(input.providerTurns.map((turn) => turn.runAttemptId));
  let latest:
    | { readonly ordinal: number; readonly attempt: number; readonly marker: string }
    | undefined;
  for (const attempt of input.attempts) {
    const run = runs.get(attempt.runId);
    if (
      attempt.turnContextMarker === undefined ||
      attempt.providerThreadId !== input.providerThreadId ||
      attempt.nativeThreadId !== input.nativeThreadId ||
      !accepted.has(attempt.id) ||
      run === undefined ||
      run.status === "rolled_back"
    )
      continue;
    if (
      latest === undefined ||
      run.ordinal > latest.ordinal ||
      (run.ordinal === latest.ordinal && attempt.attemptOrdinal > latest.attempt)
    )
      latest = {
        ordinal: run.ordinal,
        attempt: attempt.attemptOrdinal,
        marker: attempt.turnContextMarker,
      };
  }
  if (latest === undefined) return undefined;
  const deliveredOrdinal = latest.ordinal;
  const compacted = input.turnItems.some(
    (item) =>
      item.type === "compaction" &&
      item.providerThreadId === input.providerThreadId &&
      item.runId !== null &&
      (runs.get(item.runId)?.ordinal ?? -1) >= deliveredOrdinal,
  );
  return compacted ? undefined : latest.marker;
}
