import type {
  MessageId,
  OrchestrationV2Actor,
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
import * as Schema from "effect/Schema";

export interface TurnContextInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly messageId: MessageId;
  readonly text: string;
  /** Who wrote the message; agents posting into a thread are not the person. */
  readonly createdBy: OrchestrationV2Actor;
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
  /** Shown to the person in the thread with this turn, which still runs. */
  readonly notice?: TurnContextNotice;
}
/** A plain explanation for the person: `message` is what they read, `detail` goes behind Details. */
export interface TurnContextNotice {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
}
type Resolver = (input: TurnContextInput) => Effect.Effect<TurnContext, Error>;
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

/**
 * A resolver fails with this when sending the message again cannot help, so the turn stops at
 * once and the thread shows `title` and `message` instead of retrying.
 */
export class TurnContextRefusal extends Schema.TaggedError<TurnContextRefusal>()(
  "TurnContextRefusal",
  {
    code: Schema.String,
    title: Schema.String,
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

const isTurnContextRefusal = Schema.is(TurnContextRefusal);

export class TurnContextError extends Schema.TaggedError<TurnContextError>()("TurnContextError", {
  message: Schema.String,
  refusal: Schema.optional(TurnContextRefusal),
  cause: Schema.optional(Schema.Defect()),
}) {}

// Unlike optional tool hints, a failed context/access read must stop the turn.
export const turnContextFor = (
  input: TurnContextInput,
): Effect.Effect<TurnContext, TurnContextError> =>
  resolver === undefined
    ? Effect.succeed({ text: "" })
    : resolver(input).pipe(
        Effect.mapError(
          (cause) =>
            new TurnContextError({
              message: cause.message,
              ...(isTurnContextRefusal(cause) ? { refusal: cause } : {}),
              cause,
            }),
        ),
      );

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
