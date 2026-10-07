import type { TaskArchiveResult } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";

import type { RunModes } from "./agents/runModes.ts";
import type { TaskAgentServiceShape } from "./agents/TaskAgentService.ts";
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
  input: SetTasksArchivedInput & { readonly startCeiling?: RunModes | null },
) =>
  Effect.gen(function* () {
    const { startCeiling, ...change } = input;
    const results = yield* deps.repository.setArchived(change);
    for (const { task } of results) {
      if (task !== null)
        yield* deps.agents.scheduleTaskChanged({
          task,
          reason: input.archived ? "archived" : "unarchived",
          ...(startCeiling !== undefined ? { startCeiling } : {}),
        });
    }
    return {
      results: results.map(({ id, outcome }) => ({ id, outcome })),
    } satisfies TaskArchiveResult;
  });
