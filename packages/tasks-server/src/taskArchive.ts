import type { TaskArchiveResult, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";

import type { RunModes } from "./agents/runModes.ts";
import type { TaskAgentServiceShape } from "./agents/TaskAgentService.ts";
import type { TaskRepositoryError } from "./persistence/Errors.ts";
import type { SetTasksArchivedInput, TaskRepositoryShape } from "./persistence/TaskRepository.ts";

/**
 * The one way to archive or unarchive tasks, for the Tasks view and the agent
 * tools. Changes commit in one transaction; then each changed task is
 * reconciled, so an archive ends its active runs and an unarchive lets
 * matching agents start again, within `startCeiling` when an agent asked.
 */
export const setTasksArchived = (
  deps: {
    readonly repository: TaskRepositoryShape;
    readonly agents: Pick<TaskAgentServiceShape, "scheduleTaskChanged">;
  },
  input: SetTasksArchivedInput & {
    readonly startCeiling?: RunModes | null;
    /**
     * Ids the caller may not change, with the reason. Runs in the same write
     * transaction as the change, so it sees the agents as stored when the
     * change commits: no agent write can land in between.
     */
    readonly refusals?: (
      ids: ReadonlyArray<TaskId>,
    ) => Effect.Effect<ReadonlyMap<TaskId, string>, TaskRepositoryError>;
  },
) =>
  Effect.gen(function* () {
    const { startCeiling, refusals: findRefusals, ...change } = input;
    const { refusals, results } = yield* deps.repository.withChangeTransaction(
      Effect.gen(function* () {
        const refusals: ReadonlyMap<TaskId, string> =
          findRefusals === undefined ? new Map() : yield* findRefusals(change.ids);
        const results = yield* deps.repository.setArchived({
          ...change,
          ids: change.ids.filter((id) => !refusals.has(id)),
        });
        return { refusals, results };
      }),
    );
    for (const { task } of results) {
      if (task !== null)
        yield* deps.agents.scheduleTaskChanged({
          task,
          reason: input.archived ? "archived" : "unarchived",
          ...(startCeiling !== undefined ? { startCeiling } : {}),
        });
    }
    // Back in request order, with the refused ids in place.
    const changed = results.values();
    return {
      results: change.ids.map((id) => {
        const reason = refusals.get(id);
        if (reason !== undefined) return { id, outcome: "refused" as const, reason };
        const { outcome } = changed.next().value!;
        return { id, outcome };
      }),
    } satisfies TaskArchiveResult;
  });
