import type { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export interface RestartContinuationGateInput {
  readonly threadId: ThreadId;
  readonly sourceRunId: RunId;
}

/**
 * Runs `send` only when the thread's owner admits a restart continuation of
 * the source run, and says whether it ran. A product feature that owns a
 * thread's lifecycle (task-agent runs) decides here, and runs `send` under its
 * own lock so the decision cannot go stale before the turn is dispatched.
 */
export type RestartContinuationGate = <E>(
  input: RestartContinuationGateInput,
  send: Effect.Effect<void, E>,
) => Effect.Effect<boolean, E>;

let restartContinuationGate: RestartContinuationGate | undefined;

/** Registers the gate for the lifetime of the calling scope. */
export const registerRestartContinuationGate = (gate: RestartContinuationGate) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      restartContinuationGate = gate;
    }),
    () =>
      Effect.sync(() => {
        if (restartContinuationGate === gate) restartContinuationGate = undefined;
      }),
  );

/** Without a registered gate every continuation is admitted. */
export const sendRestartContinuationIfAdmitted = <E>(
  input: RestartContinuationGateInput,
  send: Effect.Effect<void, E>,
): Effect.Effect<boolean, E> =>
  restartContinuationGate === undefined
    ? Effect.as(send, true)
    : restartContinuationGate(input, send);

export const restartContinuationAdmitted = (input: RestartContinuationGateInput) =>
  sendRestartContinuationIfAdmitted(input, Effect.void);
