export interface TaskOrderItem {
  readonly id: string;
  readonly environmentId: string;
}

export interface TaskReorderRequest<Id extends string = string> {
  readonly id: Id;
  readonly beforeTaskId?: Id;
  readonly afterTaskId?: Id;
}

export interface PlannedTaskMove<T extends TaskOrderItem> {
  readonly tasks: readonly T[];
  readonly request: TaskReorderRequest<T["id"]>;
}

export type TaskMovePlanResult<T extends TaskOrderItem> =
  | { readonly ok: true; readonly plan: PlannedTaskMove<T> }
  | { readonly ok: false; readonly reason: "cross-environment" | "out-of-range" | "no-neighbors" };

function key(task: TaskOrderItem): string {
  return `${task.environmentId}:${task.id}`;
}

/**
 * Plans a move against the visible rows while retaining every hidden row.
 * The semantic neighbors are always from the moved task's environment, so the
 * server remains the authority for the exact placement among hidden ranks.
 */
export function planVisibleTaskMove<T extends TaskOrderItem>(input: {
  readonly tasks: readonly T[];
  readonly visibleTasks: readonly T[];
  readonly task: T;
  readonly directionOrTarget: "up" | "down" | T;
}): TaskMovePlanResult<T> {
  const { task, directionOrTarget } = input;
  if (
    typeof directionOrTarget !== "string" &&
    directionOrTarget.environmentId !== task.environmentId
  ) {
    return { ok: false, reason: "cross-environment" };
  }

  const visibleEnvironmentTasks = input.visibleTasks.filter(
    ({ environmentId }) => environmentId === task.environmentId,
  );
  const sourceIndex = visibleEnvironmentTasks.findIndex(({ id }) => id === task.id);
  const requestedIndex =
    typeof directionOrTarget === "string"
      ? sourceIndex + (directionOrTarget === "up" ? -1 : 1)
      : visibleEnvironmentTasks.findIndex(({ id }) => id === directionOrTarget.id);
  if (sourceIndex < 0 || requestedIndex < 0 || requestedIndex >= visibleEnvironmentTasks.length) {
    return { ok: false, reason: "out-of-range" };
  }

  const reorderedVisible = [...visibleEnvironmentTasks];
  const [moved] = reorderedVisible.splice(sourceIndex, 1);
  if (!moved) return { ok: false, reason: "out-of-range" };
  reorderedVisible.splice(requestedIndex, 0, moved);
  const movedIndex = reorderedVisible.findIndex(({ id }) => id === task.id);
  const after = reorderedVisible[movedIndex - 1];
  const before = reorderedVisible[movedIndex + 1];
  if (!after && !before) return { ok: false, reason: "no-neighbors" };

  const withoutMoved = input.tasks.filter((candidate) => key(candidate) !== key(task));
  const beforeIndex = before
    ? withoutMoved.findIndex((candidate) => key(candidate) === key(before))
    : -1;
  const afterIndex = after
    ? withoutMoved.findIndex((candidate) => key(candidate) === key(after))
    : -1;
  const tasks = [...withoutMoved];
  tasks.splice(beforeIndex >= 0 ? beforeIndex : afterIndex + 1, 0, task);

  return {
    ok: true,
    plan: {
      tasks,
      request: {
        id: task.id,
        ...(before ? { beforeTaskId: before.id } : {}),
        ...(after ? { afterTaskId: after.id } : {}),
      },
    },
  };
}

/** Executes the optimistic lifecycle independently of React so success and rollback are testable. */
export async function persistPlannedTaskMove<T extends TaskOrderItem>(input: {
  readonly previousTasks: readonly T[];
  readonly plan: PlannedTaskMove<T>;
  readonly setTasks: (tasks: readonly T[]) => void;
  readonly reorder: (request: TaskReorderRequest<T["id"]>) => Promise<unknown>;
  readonly onReload: () => void;
}): Promise<void> {
  input.setTasks(input.plan.tasks);
  try {
    await input.reorder(input.plan.request);
    input.onReload();
  } catch (error) {
    input.setTasks(input.previousTasks);
    throw error;
  }
}
