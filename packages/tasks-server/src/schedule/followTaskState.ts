import { PERSON_DONE_STATUS, type TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

/** What of a task its entries follow. */
export interface FollowedTaskState {
  readonly status: string;
  readonly archived: boolean;
}

/** Statuses that mean the task was dropped. No status of the task system is reserved for it. */
const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);

const isDone = (state: FollowedTaskState) => state.status === PERSON_DONE_STATUS;
const isCancelled = (state: FollowedTaskState) =>
  CANCELLED_STATUSES.has(state.status.toLowerCase());

/** Whether the change takes the task out of Done and back into work. */
export function reopensTask(from: FollowedTaskState, to: FollowedTaskState): boolean {
  return isDone(from) && !isDone(to) && !isCancelled(to);
}

/** Whether a change of a task's state can move its entries; most writes cannot. */
export function movesEntries(from: FollowedTaskState, to: FollowedTaskState): boolean {
  return from.status !== to.status || from.archived !== to.archived;
}

/**
 * How a regular task's entries follow a change of its state, wherever the
 * change came from (doc 5.3). `today` is the schedule's date now, `at` the
 * time of the change, `doneAt` when the task last became Done (used when it
 * is reopened):
 *
 * - Done: open entries up to today are done, later ones are deleted.
 * - Back from Done into work: today's entry that became done with the task
 *   (still done, untouched since `doneAt`) is open again; nothing else moves.
 * - Cancelled or archived: open entries are skipped.
 */
export function followTaskState(input: {
  readonly entries: ReadonlyArray<TaskScheduleEntry>;
  readonly from: FollowedTaskState;
  readonly to: FollowedTaskState;
  readonly today: string;
  readonly at: string;
  readonly doneAt: string | null;
}): {
  readonly updated: ReadonlyArray<TaskScheduleEntry>;
  readonly deleted: ReadonlyArray<TaskScheduleEntry>;
} {
  const { from, to, today, at } = input;
  const updated: TaskScheduleEntry[] = [];
  const deleted: TaskScheduleEntry[] = [];
  const set = (entry: TaskScheduleEntry, status: TaskScheduleEntry["status"]) =>
    updated.push({ ...entry, status, updatedAt: at });
  const closes = (!isCancelled(from) && isCancelled(to)) || (!from.archived && to.archived);
  for (const entry of input.entries) {
    if (entry.status === "open" && !isDone(from) && isDone(to)) {
      if (entry.date > today) deleted.push(entry);
      else set(entry, "done");
    } else if (entry.status === "open" && closes) {
      set(entry, "skipped");
    } else if (
      reopensTask(from, to) &&
      entry.status === "done" &&
      entry.date === today &&
      entry.updatedAt === input.doneAt
    ) {
      set(entry, "open");
    }
  }
  return { updated, deleted };
}
