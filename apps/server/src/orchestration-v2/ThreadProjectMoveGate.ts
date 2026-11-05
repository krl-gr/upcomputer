import type { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export interface ThreadProjectMoveGateInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
}

/**
 * Why a thread may not move to the project, or null. A product feature that keeps a thread in
 * a project of its choosing (a bot's chat) refuses other moves here; a failure refuses too.
 */
export type ThreadProjectMoveGate = (
  input: ThreadProjectMoveGateInput,
) => Effect.Effect<string | null, Error>;

let threadProjectMoveGate: ThreadProjectMoveGate | undefined;

/** Registers the gate for the lifetime of the calling scope. */
export const registerThreadProjectMoveGate = (gate: ThreadProjectMoveGate) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      threadProjectMoveGate = gate;
    }),
    () =>
      Effect.sync(() => {
        if (threadProjectMoveGate === gate) threadProjectMoveGate = undefined;
      }),
  );

/** Without a registered gate every move the orchestrator accepts is admitted. */
export const threadProjectMoveRefusal = (input: ThreadProjectMoveGateInput) =>
  threadProjectMoveGate === undefined ? Effect.succeed(null) : threadProjectMoveGate(input);
