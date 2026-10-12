import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { TaskId, TaskListItem, TaskRank } from "./tasks.ts";

/**
 * A schedule entry says the person plans to work on a task on a day,
 * optionally at a time for a duration. A task may have any number of entries,
 * several on one day too. Entries store no copy of the task: reads join it.
 */
export const TaskScheduleEntryId = TrimmedNonEmptyString.pipe(Schema.brand("TaskScheduleEntryId"));
export type TaskScheduleEntryId = typeof TaskScheduleEntryId.Type;

/** A calendar day in the person's time zone, YYYY-MM-DD, stored without a zone. */
export const TaskScheduleDate = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
    Schema.makeFilter((date: string) => {
      const [year, month, day] = date.split("-").map(Number) as [number, number, number];
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
      return day <= days || "Expected an existing calendar date";
    }),
  ),
);
export type TaskScheduleDate = typeof TaskScheduleDate.Type;

/** A wall-clock time, HH:MM, in the person's time zone. */
export const TaskScheduleTime = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
);
export type TaskScheduleTime = typeof TaskScheduleTime.Type;

export const TaskScheduleDuration = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(1440),
);
export type TaskScheduleDuration = typeof TaskScheduleDuration.Type;

/**
 * `done`: the session happened. `skipped`: planned, not done and not carried
 * over. Both count as handled. Marking an entry leaves the task's status
 * alone; a task's status change moves its open entries (Done, cancelled,
 * archived), except a routine's.
 */
export const TaskScheduleEntryStatus = Schema.Literals(["open", "done", "skipped"]);
export type TaskScheduleEntryStatus = typeof TaskScheduleEntryStatus.Type;

export const TaskScheduleEntry = Schema.Struct({
  id: TaskScheduleEntryId,
  taskId: TaskId,
  date: TaskScheduleDate,
  /** Order within the date; opaque, like a task rank. */
  position: TaskRank,
  /** Null for an untimed entry. */
  startTime: Schema.NullOr(TaskScheduleTime),
  /** Null uses the client's default duration. */
  durationMinutes: Schema.NullOr(TaskScheduleDuration),
  status: TaskScheduleEntryStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskScheduleEntry = typeof TaskScheduleEntry.Type;

/**
 * Where entries go within their target date: first, last, or next to an entry
 * already on that date. Without a placement an entry with a start time goes
 * before the first entry that starts later, and any other entry goes last.
 */
export const TaskSchedulePlacement = Schema.Union([
  Schema.Struct({ at: Schema.Literals(["top", "bottom"]) }),
  Schema.Struct({ before: TaskScheduleEntryId }),
  Schema.Struct({ after: TaskScheduleEntryId }),
]);
export type TaskSchedulePlacement = typeof TaskSchedulePlacement.Type;

export const TASK_SCHEDULE_MAX_IDS = 500;
export const TASK_SCHEDULE_RANGE_MAX_DAYS = 62;

const entryIds = Schema.Array(TaskScheduleEntryId).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TASK_SCHEDULE_MAX_IDS),
);

/** Entries from `from` to `to`, both included, at most 62 days. */
export const TaskScheduleRangeInput = Schema.Struct({
  from: TaskScheduleDate,
  to: TaskScheduleDate,
});
export type TaskScheduleRangeInput = typeof TaskScheduleRangeInput.Type;
/** Entries by date and position, and every task they reference, once. */
export const TaskScheduleRangeResult = Schema.Struct({
  entries: Schema.Array(TaskScheduleEntry),
  tasks: Schema.Array(TaskListItem),
});
export type TaskScheduleRangeResult = typeof TaskScheduleRangeResult.Type;

export const TaskScheduleForTaskCursor = Schema.Struct({
  date: TaskScheduleDate,
  startTime: Schema.NullOr(TaskScheduleTime),
  position: TaskRank,
});
export type TaskScheduleForTaskCursor = typeof TaskScheduleForTaskCursor.Type;
/** One task's entries by date, start time (untimed last) and position. */
export const TaskScheduleForTaskInput = Schema.Struct({
  taskId: TaskId,
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
  cursor: Schema.optional(TaskScheduleForTaskCursor),
});
export type TaskScheduleForTaskInput = typeof TaskScheduleForTaskInput.Type;
export const TaskScheduleForTaskResult = Schema.Struct({
  entries: Schema.Array(TaskScheduleEntry),
  nextCursor: Schema.NullOr(TaskScheduleForTaskCursor),
});
export type TaskScheduleForTaskResult = typeof TaskScheduleForTaskResult.Type;

/** The task_schedule_get tool: a date range (`from`, `to`), or one task's entries (`taskId`). */
export const TaskScheduleToolGetInput = Schema.Struct({
  from: Schema.optional(TaskScheduleDate),
  to: Schema.optional(TaskScheduleDate),
  taskId: Schema.optional(TaskId),
  limit: TaskScheduleForTaskInput.fields.limit,
  cursor: TaskScheduleForTaskInput.fields.cursor,
});
export type TaskScheduleToolGetInput = typeof TaskScheduleToolGetInput.Type;

/** Entry counts per task, optionally within a date range; handled is done or skipped. */
export const TaskScheduleProgressInput = Schema.Struct({
  taskIds: Schema.Array(TaskId).check(Schema.isMaxLength(TASK_SCHEDULE_MAX_IDS)),
  from: Schema.optional(TaskScheduleDate),
  to: Schema.optional(TaskScheduleDate),
});
export type TaskScheduleProgressInput = typeof TaskScheduleProgressInput.Type;
export const TaskScheduleProgress = Schema.Struct({
  taskId: TaskId,
  total: Schema.Number,
  handled: Schema.Number,
});
export type TaskScheduleProgress = typeof TaskScheduleProgress.Type;
export const TaskScheduleProgressResult = Schema.Struct({
  progress: Schema.Array(TaskScheduleProgress),
});
export type TaskScheduleProgressResult = typeof TaskScheduleProgressResult.Type;

/** New open entries for the tasks, in the given order, on one date. */
export const TaskScheduleAddInput = Schema.Struct({
  taskIds: Schema.Array(TaskId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(TASK_SCHEDULE_MAX_IDS),
  ),
  date: TaskScheduleDate,
  placement: Schema.optional(TaskSchedulePlacement),
  startTime: Schema.optional(TaskScheduleTime),
  durationMinutes: Schema.optional(TaskScheduleDuration),
});
export type TaskScheduleAddInput = typeof TaskScheduleAddInput.Type;

/** Patches one entry in place; null clears a timing field. */
export const TaskScheduleUpdateInput = Schema.Struct({
  id: TaskScheduleEntryId,
  status: Schema.optional(TaskScheduleEntryStatus),
  startTime: Schema.optional(Schema.NullOr(TaskScheduleTime)),
  durationMinutes: Schema.optional(Schema.NullOr(TaskScheduleDuration)),
});
export type TaskScheduleUpdateInput = typeof TaskScheduleUpdateInput.Type;

/**
 * Moves entries, keeping their ids and status, to a date as one block in
 * their current order (by date, then position). Timing given here replaces
 * every moved entry's timing; null clears it.
 */
export const TaskScheduleMoveInput = Schema.Struct({
  ids: entryIds,
  date: TaskScheduleDate,
  placement: Schema.optional(TaskSchedulePlacement),
  startTime: Schema.optional(Schema.NullOr(TaskScheduleTime)),
  durationMinutes: Schema.optional(Schema.NullOr(TaskScheduleDuration)),
});
export type TaskScheduleMoveInput = typeof TaskScheduleMoveInput.Type;

/** Copies entries to each date as new open entries, keeping their timing and order. */
export const TaskScheduleCopyInput = Schema.Struct({
  ids: entryIds,
  dates: Schema.Array(TaskScheduleDate).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(TASK_SCHEDULE_RANGE_MAX_DAYS),
  ),
  placement: Schema.optional(TaskSchedulePlacement),
});
export type TaskScheduleCopyInput = typeof TaskScheduleCopyInput.Type;

export const TaskScheduleDeleteInput = Schema.Struct({ ids: entryIds });
export type TaskScheduleDeleteInput = typeof TaskScheduleDeleteInput.Type;

/** Moves every open entry of `fromDate` to the end of `toDate`, in order. */
export const TaskScheduleMoveOpenInput = Schema.Struct({
  fromDate: TaskScheduleDate,
  toDate: TaskScheduleDate,
});
export type TaskScheduleMoveOpenInput = typeof TaskScheduleMoveOpenInput.Type;

/** The entries a write created or changed; for a delete, the removed entries. */
export const TaskScheduleWriteResult = Schema.Struct({
  entries: Schema.Array(TaskScheduleEntry),
});
export type TaskScheduleWriteResult = typeof TaskScheduleWriteResult.Type;

export const TaskReminderLeadMinutes = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1440),
);
export const DEFAULT_TASK_REMINDER_LEAD_MINUTES = 10;

/**
 * The server's schedule settings. Entry dates and times are wall-clock values
 * in `scheduleTimeZone`; reminders turn them into instants with it.
 */
export const TaskScheduleSettings = Schema.Struct({
  /** An IANA time zone; null follows the server's own zone. */
  scheduleTimeZone: Schema.NullOr(TrimmedNonEmptyString),
  /** The zone a null `scheduleTimeZone` means. */
  serverTimeZone: Schema.String,
  /** Reminders for timed open entries, `reminderLeadMinutes` before they start. */
  remindersEnabled: Schema.Boolean,
  reminderLeadMinutes: TaskReminderLeadMinutes,
});
export type TaskScheduleSettings = typeof TaskScheduleSettings.Type;

export const TaskScheduleSettingsGetInput = Schema.Struct({});
export type TaskScheduleSettingsGetInput = typeof TaskScheduleSettingsGetInput.Type;

/** Changes the given settings; every pending reminder is recomputed. */
export const TaskScheduleSettingsUpdateInput = Schema.Struct({
  scheduleTimeZone: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  remindersEnabled: Schema.optional(Schema.Boolean),
  reminderLeadMinutes: Schema.optional(TaskReminderLeadMinutes),
});
export type TaskScheduleSettingsUpdateInput = typeof TaskScheduleSettingsUpdateInput.Type;
