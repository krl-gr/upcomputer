import type { Task, TaskSearchInput } from "@t3tools/tasks-contracts/v1";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import type { TasksWebAccess, TasksWebRpcClient } from "../rpc/index.ts";
import { reuseRows, sameEnvironmentStatuses } from "./recent.ts";

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

const taskRowKey = (row: ScopedTask) => `${row.environmentId}:${row.id}`;

/** `next` with the unchanged tasks of `previous`, or `previous` itself when nothing changed. */
export function reuseTasksState(previous: TasksDataState, next: TasksDataState): TasksDataState {
  const tasks = reuseRows(previous.tasks, next.tasks, taskRowKey);
  if (
    tasks === previous.tasks &&
    sameEnvironmentStatuses(previous.byEnvironment, next.byEnvironment)
  )
    return previous;
  return { ...next, tasks };
}

/** Only the environments `readable` allows, for showing kept data before a load answers. */
export function readableTasksState(
  state: TasksDataState,
  readable: (environmentId: string) => boolean,
): TasksDataState {
  const environments = Object.keys(state.byEnvironment);
  if (environments.every(readable)) return state;
  return {
    byEnvironment: Object.fromEntries(
      Object.entries(state.byEnvironment).filter(([environmentId]) => readable(environmentId)),
    ),
    tasks: state.tasks.filter((task) => readable(task.environmentId)),
  };
}
