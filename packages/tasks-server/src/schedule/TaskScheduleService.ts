import {
  TASK_SCHEDULE_RANGE_MAX_DAYS,
  TaskError,
  TaskScheduleEntryId,
  type TaskRank,
  type TaskScheduleAddInput,
  type TaskScheduleCopyInput,
  type TaskScheduleDeleteInput,
  type TaskScheduleEntry,
  type TaskScheduleForTaskInput,
  type TaskScheduleForTaskResult,
  type TaskScheduleMoveInput,
  type TaskScheduleMoveOpenInput,
  type TaskSchedulePlacement,
  type TaskScheduleProgressInput,
  type TaskScheduleProgressResult,
  type TaskScheduleRangeInput,
  type TaskScheduleRangeResult,
  type TaskScheduleUpdateInput,
  type TaskScheduleWriteResult,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TaskRepositoryError } from "../persistence/Errors.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TASK_RANK_STEP, encodeTaskRank, taskRanksBetween } from "../persistence/taskRank.ts";

type ScheduleEffect<A> = Effect.Effect<A, TaskError | TaskRepositoryError>;

/**
 * The planner's schedule: entries of tasks on dates. The RPC handlers and the
 * schedule tools both use it. Every write is one transaction and one change.
 */
export interface TaskScheduleServiceShape {
  readonly range: (input: TaskScheduleRangeInput) => ScheduleEffect<TaskScheduleRangeResult>;
  readonly forTask: (input: TaskScheduleForTaskInput) => ScheduleEffect<TaskScheduleForTaskResult>;
  readonly progress: (
    input: TaskScheduleProgressInput,
  ) => ScheduleEffect<TaskScheduleProgressResult>;
  readonly add: (input: TaskScheduleAddInput) => ScheduleEffect<TaskScheduleWriteResult>;
  readonly update: (input: TaskScheduleUpdateInput) => ScheduleEffect<TaskScheduleWriteResult>;
  readonly move: (input: TaskScheduleMoveInput) => ScheduleEffect<TaskScheduleWriteResult>;
  readonly copy: (input: TaskScheduleCopyInput) => ScheduleEffect<TaskScheduleWriteResult>;
  readonly remove: (input: TaskScheduleDeleteInput) => ScheduleEffect<TaskScheduleWriteResult>;
  readonly moveOpen: (input: TaskScheduleMoveOpenInput) => ScheduleEffect<TaskScheduleWriteResult>;
}

export class TaskScheduleService extends Context.Service<
  TaskScheduleService,
  TaskScheduleServiceShape
>()("@t3tools/tasks-server/schedule/TaskScheduleService") {}

const fail = (message: string) => Effect.fail(new TaskError({ message }));

/** Days since 1970-01-01 of a YYYY-MM-DD date. */
function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

const byDateAndPosition = (left: TaskScheduleEntry, right: TaskScheduleEntry) =>
  left.date === right.date
    ? left.position.localeCompare(right.position)
    : left.date.localeCompare(right.date);

/**
 * Where a block goes among a date's other entries (in order): the placement,
 * else before the first entry that starts after `startTime`, else last.
 * Untimed entries never move to make room. A string is a refusal.
 */
function insertionIndex(
  others: ReadonlyArray<TaskScheduleEntry>,
  placement: TaskSchedulePlacement | undefined,
  startTime: string | null,
): number | string {
  if (placement === undefined) {
    if (startTime === null) return others.length;
    const later = others.findIndex(
      (entry) => entry.startTime !== null && entry.startTime > startTime,
    );
    return later < 0 ? others.length : later;
  }
  if ("at" in placement) return placement.at === "top" ? 0 : others.length;
  const anchor = "before" in placement ? placement.before : placement.after;
  const index = others.findIndex((entry) => entry.id === anchor);
  if (index < 0)
    return `Entry '${anchor}' is not on the target date, or is one of the entries being placed.`;
  return "before" in placement ? index : index + 1;
}

/**
 * Positions for `count` entries inserted at `index` among `others`. When the
 * gap is used up, the whole date is renumbered: `others` then lists the other
 * entries with their new positions.
 */
function planPositions(
  others: ReadonlyArray<TaskScheduleEntry>,
  index: number,
  count: number,
): { readonly block: TaskRank[]; readonly others: ReadonlyArray<TaskScheduleEntry> } {
  const between = taskRanksBetween(
    others[index - 1]?.position ?? null,
    others[index]?.position ?? null,
    count,
  );
  if (between !== null) return { block: between, others: [] };
  const rank = (slot: number) => encodeTaskRank(BigInt(slot + 1) * TASK_RANK_STEP);
  return {
    block: Array.from({ length: count }, (_, offset) => rank(index + offset)),
    others: others.map((entry, at) => ({
      ...entry,
      position: rank(at < index ? at : at + count),
    })),
  };
}

const make = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const crypto = yield* Crypto.Crypto;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const newEntryId = crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => TaskScheduleEntryId.make(`task-schedule-entry-${uuid}`)),
    Effect.orDie,
  );

  const entriesOn = (date: string) => repository.scheduleEntries({ dates: [date] });

  /** All requested entries, or a refusal naming the first missing one. */
  const existingEntries = (ids: ReadonlyArray<TaskScheduleEntryId>) =>
    Effect.gen(function* () {
      const unique = [...new Set(ids)];
      const found = yield* repository.scheduleEntries({ ids: unique });
      const missing = unique.find((id) => !found.some((entry) => entry.id === id));
      if (missing !== undefined) return yield* fail(`Schedule entry '${missing}' was not found.`);
      return found.toSorted(byDateAndPosition);
    });

  /** Writes a planned block plus any renumbered entries of its date. */
  const placeBlock = (
    others: ReadonlyArray<TaskScheduleEntry>,
    placement: TaskSchedulePlacement | undefined,
    startTime: string | null,
    block: ReadonlyArray<Omit<TaskScheduleEntry, "position">>,
  ) =>
    Effect.gen(function* () {
      const index = insertionIndex(others, placement, startTime);
      if (typeof index === "string") return yield* fail(index);
      const timestamp = yield* now;
      const planned = planPositions(others, index, block.length);
      return [
        ...planned.others.map((entry) => ({ ...entry, updatedAt: timestamp })),
        ...block.map((entry, at) => ({ ...entry, position: planned.block[at]! })),
      ];
    });

  const write = (effect: ScheduleEffect<ReadonlyArray<TaskScheduleEntry>>) =>
    repository
      .withChangeTransaction(
        effect.pipe(Effect.flatMap((entries) => repository.putScheduleEntries(entries))),
      )
      .pipe(Effect.map((entries) => ({ entries })));

  const range: TaskScheduleServiceShape["range"] = (input) =>
    Effect.gen(function* () {
      const days = dayNumber(input.to) - dayNumber(input.from) + 1;
      if (days < 1) return yield* fail("The range ends before it starts.");
      if (days > TASK_SCHEDULE_RANGE_MAX_DAYS)
        return yield* fail(`A range covers at most ${TASK_SCHEDULE_RANGE_MAX_DAYS} days.`);
      return yield* repository.scheduleRange(input);
    });

  const add: TaskScheduleServiceShape["add"] = (input) =>
    write(
      Effect.gen(function* () {
        const unique = [...new Set(input.taskIds)];
        const { tasks } = yield* repository.items({ ids: unique });
        const missing = unique.find((id) => !tasks.some((task) => task.id === id));
        if (missing !== undefined) return yield* fail(`Task '${missing}' was not found.`);
        const timestamp = yield* now;
        const block = yield* Effect.forEach(input.taskIds, (taskId) =>
          newEntryId.pipe(
            Effect.map((id) => ({
              id,
              taskId,
              date: input.date,
              startTime: input.startTime ?? null,
              durationMinutes: input.durationMinutes ?? null,
              status: "open" as const,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          ),
        );
        return yield* placeBlock(
          yield* entriesOn(input.date),
          input.placement,
          input.startTime ?? null,
          block,
        );
      }),
    );

  const update: TaskScheduleServiceShape["update"] = (input) =>
    write(
      Effect.gen(function* () {
        const [entry] = yield* existingEntries([input.id]);
        return [
          {
            ...entry!,
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
            ...(input.durationMinutes !== undefined
              ? { durationMinutes: input.durationMinutes }
              : {}),
            updatedAt: yield* now,
          },
        ];
      }),
    );

  const moveBlock = (
    moved: ReadonlyArray<TaskScheduleEntry>,
    date: string,
    placement: TaskSchedulePlacement | undefined,
    timing: Pick<TaskScheduleMoveInput, "startTime" | "durationMinutes">,
  ) =>
    Effect.gen(function* () {
      const ids = new Set(moved.map(({ id }) => id));
      const others = (yield* entriesOn(date)).filter(({ id }) => !ids.has(id));
      const timestamp = yield* now;
      return yield* placeBlock(
        others,
        placement,
        timing.startTime ?? null,
        moved.map(({ position: _position, ...entry }) => ({
          ...entry,
          date,
          ...(timing.startTime !== undefined ? { startTime: timing.startTime } : {}),
          ...(timing.durationMinutes !== undefined
            ? { durationMinutes: timing.durationMinutes }
            : {}),
          updatedAt: timestamp,
        })),
      );
    });

  const move: TaskScheduleServiceShape["move"] = (input) =>
    write(
      Effect.gen(function* () {
        return yield* moveBlock(
          yield* existingEntries(input.ids),
          input.date,
          input.placement,
          input,
        );
      }),
    );

  const copy: TaskScheduleServiceShape["copy"] = (input) =>
    write(
      Effect.gen(function* () {
        const sources = yield* existingEntries(input.ids);
        const dates = [...new Set(input.dates)];
        const targets = yield* repository.scheduleEntries({ dates });
        const timestamp = yield* now;
        const written: TaskScheduleEntry[] = [];
        for (const date of dates) {
          const block = yield* Effect.forEach(sources, (source) =>
            newEntryId.pipe(
              Effect.map((id) => ({
                id,
                taskId: source.taskId,
                date,
                startTime: source.startTime,
                durationMinutes: source.durationMinutes,
                status: "open" as const,
                createdAt: timestamp,
                updatedAt: timestamp,
              })),
            ),
          );
          const others = targets.filter((entry) => entry.date === date);
          written.push(...(yield* placeBlock(others, input.placement, null, block)));
        }
        return written;
      }),
    );

  const remove: TaskScheduleServiceShape["remove"] = (input) =>
    repository
      .deleteScheduleEntries([...new Set(input.ids)])
      .pipe(Effect.map((entries) => ({ entries })));

  const moveOpen: TaskScheduleServiceShape["moveOpen"] = (input) =>
    write(
      Effect.gen(function* () {
        if (input.fromDate === input.toDate) return [];
        const open = (yield* entriesOn(input.fromDate)).filter(({ status }) => status === "open");
        if (open.length === 0) return [];
        return yield* moveBlock(open, input.toDate, { at: "bottom" }, {});
      }),
    );

  return {
    range,
    forTask: (input) => repository.scheduleForTask(input),
    progress: (input) => repository.scheduleProgress(input),
    add,
    update,
    move,
    copy,
    remove,
    moveOpen,
  } satisfies TaskScheduleServiceShape;
});

export const TaskScheduleServiceLive = Layer.effect(TaskScheduleService, make);
