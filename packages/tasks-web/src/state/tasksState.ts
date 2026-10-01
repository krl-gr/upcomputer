import type { Task, TaskSearchInput } from "@upcomputer/tasks-contracts/v1";
import type { EnvironmentId, ProjectId } from "@upcomputer/contracts";

import type { TasksWebAccess, TasksWebRpcClient } from "../rpc/index.ts";

export type ScopedTask = Task & {
  readonly environmentId: EnvironmentId;
  readonly projectName: string | null;
};

export type EnvironmentTasksState =
  | { readonly status: "loading"; readonly tasks: ReadonlyArray<ScopedTask> }
  | { readonly status: "ready"; readonly tasks: ReadonlyArray<ScopedTask> }
  | {
      readonly status: "unavailable";
      readonly tasks: ReadonlyArray<ScopedTask>;
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly tasks: ReadonlyArray<ScopedTask>;
      readonly message: string;
    };

export interface TasksDataState {
  readonly byEnvironment: Readonly<Record<string, EnvironmentTasksState>>;
  readonly tasks: ReadonlyArray<ScopedTask>;
}

export interface TasksStateTarget {
  readonly environmentId: EnvironmentId;
  readonly client: TasksWebRpcClient;
  readonly access: TasksWebAccess;
  readonly search?: TaskSearchInput;
  readonly projectNameById?: ReadonlyMap<ProjectId, string>;
}

export function compareScopedTaskOrder(left: ScopedTask, right: ScopedTask): number {
  const environment = left.environmentId.localeCompare(right.environmentId);
  return environment || left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "Failed to load tasks.";
}

export async function loadTasksState(
  targets: ReadonlyArray<TasksStateTarget>,
  previous?: TasksDataState,
): Promise<TasksDataState> {
  const entries = await Promise.all(
    targets.map(async (target): Promise<readonly [string, EnvironmentTasksState]> => {
      const previousTasks = previous?.byEnvironment[target.environmentId]?.tasks ?? [];
      if (!target.access.canReadTasks) {
        return [
          target.environmentId,
          {
            status: "unavailable",
            tasks: previousTasks,
            message: target.access.reason,
          },
        ];
      }
      try {
        const result = await target.client.tasks.search(target.search ?? { limit: 200 });
        return [
          target.environmentId,
          {
            status: "ready",
            tasks: result.tasks.map((task) => ({
              ...task,
              environmentId: target.environmentId,
              projectName: target.projectNameById?.get(task.projectId) ?? null,
            })),
          },
        ];
      } catch (error) {
        return [
          target.environmentId,
          { status: "error", tasks: previousTasks, message: errorMessage(error) },
        ];
      }
    }),
  );
  const byEnvironment = Object.fromEntries(entries);
  // Each environment owns one global order. Aggregation groups stores by stable
  // environment id rather than pretending that ranks are atomic across databases.
  const tasks = entries.flatMap(([, state]) => state.tasks).sort(compareScopedTaskOrder);
  return { byEnvironment, tasks };
}
