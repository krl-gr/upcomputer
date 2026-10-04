import {
  TaskId,
  type TaskAutomation,
  type TaskAutomationRunOutcome,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { TaskRepository, type PersistTaskInput } from "../persistence/TaskRepository.ts";
import {
  AUTOMATION_FAILURE_LIMIT,
  decideAutomationSlot,
  describeSchedule,
} from "./automationSchedule.ts";

/**
 * Polling beats a long timer here: the host is a desktop machine that sleeps,
 * and a fiber parked for eight hours wakes up with a stale deadline.
 */
const AUTOMATION_TICK_INTERVAL = Duration.seconds(30);

export interface TaskAutomationServiceShape {
  /** Runs one scheduler pass. Exposed so tests can drive it deterministically. */
  readonly tick: Effect.Effect<void>;
  readonly recover: Effect.Effect<void>;
}

export class TaskAutomationService extends Context.Service<
  TaskAutomationService,
  TaskAutomationServiceShape
>()("@t3tools/tasks-server/automations/TaskAutomationService") {}

const make = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const agents = yield* TaskAgentService;
  const crypto = yield* Crypto.Crypto;

  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const randomId = (prefix: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => `${prefix}-${uuid}`));

  interface FireResult {
    readonly at: string;
    readonly slot: string;
    readonly taskId: TaskId;
  }

  /**
   * Writes back only the columns a scheduler pass owns, and only while the
   * automation is still enabled. A person who pauses, edits, or deletes an
   * automation mid-pass wins; the pass notices it lost the row and moves on.
   */
  const persistSchedule = (
    automation: TaskAutomation,
    patch: {
      readonly nextRunAt: string | null;
      readonly fired?: FireResult;
      readonly lastError?: string | null;
      readonly failureCount?: number;
    },
  ) =>
    Effect.gen(function* () {
      const applied = yield* repository.updateAutomationSchedule({
        id: automation.id,
        nextRunAt: patch.nextRunAt,
        firedAt: patch.fired?.at ?? null,
        firedSlot: patch.fired?.slot ?? null,
        firedTaskId: patch.fired?.taskId ?? null,
        lastError: patch.lastError ?? null,
        failureCount: patch.failureCount ?? 0,
        updatedAt: yield* now,
      });
      if (!applied) {
        yield* Effect.logInfo("Skipped a stale task automation write", {
          automationId: automation.id,
        });
      }
    });

  const park = (automation: TaskAutomation, lastError: string, failureCount: number) =>
    now.pipe(
      Effect.flatMap((updatedAt) =>
        repository.parkAutomation({
          id: automation.id,
          status: "disabled",
          lastError,
          failureCount,
          updatedAt,
        }),
      ),
      Effect.asVoid,
    );

  const recordOutcome = (
    automation: TaskAutomation,
    slot: string,
    outcome: TaskAutomationRunOutcome,
    taskId: TaskId | null,
    detail: string | null,
  ) =>
    repository.completeAutomationRun({
      automationId: automation.id,
      slot,
      taskId,
      outcome,
      detail,
    });

  /**
   * Matches on task metadata rather than `lastTaskId`: a crash between creating
   * the task and recording it would leave that pointer unset, and the next slot
   * would then create a duplicate instead of suppressing itself.
   */
  const hasOpenTask = (automation: TaskAutomation) =>
    repository
      .countOpenAutomationTasks({ id: automation.id })
      .pipe(Effect.map((count) => count > 0));

  const createTaskForSlot = (automation: TaskAutomation, slot: string) =>
    Effect.gen(function* () {
      const timestamp = yield* now;
      const task: PersistTaskInput = {
        id: TaskId.make(yield* randomId("task")),
        projectId: automation.projectId,
        title: automation.template.title,
        description: automation.template.description,
        output: null,
        status: automation.template.status,
        priority: automation.template.priority,
        createdBy: `automation:${automation.id}`,
        assigneeAgentRunId: null,
        sourceThreadId: null,
        sourceRunId: null,
        metadata: {
          source: "automation",
          automationId: automation.id,
          automationName: automation.name,
          slot,
        },
        tags: automation.template.tags,
        createdAt: timestamp,
        updatedAt: timestamp,
        closedAt: null,
      };
      const saved = yield* repository.upsert(task);
      // Agents pick the task up through the existing reconciler; automations
      // never start a run themselves, so there stays one dispatch path.
      yield* agents.scheduleTaskChanged({ task: saved, reason: "created" });
      return saved;
    });

  const fire = (automation: TaskAutomation, slot: string, nextRunAt: string) =>
    Effect.gen(function* () {
      const claimedAt = yield* now;
      // The slot is claimed pessimistically: if the process dies between the
      // claim and the task write, the run record honestly reads as a failure
      // rather than a fire that never produced anything.
      const claimed = yield* repository.claimAutomationSlot({
        automationId: automation.id,
        slot,
        taskId: null,
        outcome: "failed",
        detail: "Interrupted before the task was created.",
        createdAt: claimedAt,
      });
      if (!claimed) {
        // Another pass already owns this slot. Only re-arm the schedule.
        yield* persistSchedule(automation, { nextRunAt });
        return;
      }

      if (automation.skipIfOpen && (yield* hasOpenTask(automation))) {
        yield* recordOutcome(
          automation,
          slot,
          "skipped-open",
          null,
          "A task from this automation is still open.",
        );
        yield* persistSchedule(automation, { nextRunAt });
        return;
      }

      const task = yield* createTaskForSlot(automation, slot);
      yield* recordOutcome(automation, slot, "created", task.id, null);
      yield* persistSchedule(automation, {
        nextRunAt,
        fired: { at: claimedAt, slot, taskId: task.id },
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const failureCount = automation.failureCount + 1;
          const message = `Automation '${automation.name}' failed to fire: ${String(cause)}`;
          yield* recordOutcome(automation, slot, "failed", null, message).pipe(Effect.ignore);
          // Always advance the schedule, otherwise a permanently broken
          // automation would retry every tick for as long as the server runs.
          if (failureCount >= AUTOMATION_FAILURE_LIMIT) {
            yield* park(automation, message, failureCount).pipe(Effect.ignore);
          } else {
            yield* persistSchedule(automation, {
              nextRunAt,
              lastError: message,
              failureCount,
            }).pipe(Effect.ignore);
          }
          yield* Effect.logError("Task automation failed to fire", {
            automationId: automation.id,
            slot,
            cause,
          });
        }),
      ),
    );

  const evaluate = (automation: TaskAutomation) =>
    Effect.gen(function* () {
      const instant = new Date(yield* now);
      const decision = decideAutomationSlot(automation, instant);
      switch (decision.kind) {
        case "invalid": {
          // A schedule that no longer parses cannot be re-armed, so park it
          // rather than logging the same failure on every tick.
          yield* park(automation, decision.message, automation.failureCount + 1);
          yield* Effect.logWarning("Disabled a task automation with an invalid schedule", {
            automationId: automation.id,
            schedule: describeSchedule(automation.schedule),
          });
          return;
        }
        case "not-due": {
          if (automation.nextRunAt !== decision.nextRunAt) {
            yield* persistSchedule(automation, { nextRunAt: decision.nextRunAt });
          }
          return;
        }
        case "skip-catch-up": {
          const claimed = yield* repository.claimAutomationSlot({
            automationId: automation.id,
            slot: decision.slot,
            taskId: null,
            outcome: "skipped-catch-up",
            detail: `Missed by ${Math.round(decision.missedByMs / 1000)}s while the server was unavailable.`,
            createdAt: instant.toISOString(),
          });
          yield* persistSchedule(automation, { nextRunAt: decision.nextRunAt });
          if (!claimed) return;
          yield* Effect.logInfo("Skipped a missed task automation slot", {
            automationId: automation.id,
            slot: decision.slot,
          });
          return;
        }
        case "fire": {
          yield* fire(automation, decision.slot, decision.nextRunAt);
          return;
        }
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Failed to evaluate a task automation", {
          automationId: automation.id,
          cause,
        }),
      ),
    );

  const tick = Effect.gen(function* () {
    const automations = yield* repository.listAutomationsByStatus({ status: "enabled" });
    yield* Effect.forEach(automations, evaluate, { discard: true, concurrency: 1 });
  }).pipe(Effect.catchCause((cause) => Effect.logError("Task automation tick failed", { cause })));

  /**
   * Re-arms every enabled automation on startup. Slots missed while the process
   * was down are resolved by each automation's catch-up policy on the first
   * tick, not replayed one by one.
   */
  const recover = Effect.gen(function* () {
    const automations = yield* repository.listAutomationsByStatus({ status: "enabled" });
    yield* Effect.forEach(
      automations.filter((automation) => automation.nextRunAt === null),
      (automation) => evaluate(automation),
      { discard: true, concurrency: 1 },
    );
  }).pipe(
    Effect.catchCause((cause) => Effect.logError("Task automation recovery failed", { cause })),
  );

  yield* Effect.forkScoped(
    recover.pipe(
      Effect.andThen(Effect.forever(Effect.andThen(Effect.sleep(AUTOMATION_TICK_INTERVAL), tick))),
    ),
  );

  return { tick, recover } satisfies TaskAutomationServiceShape;
});

export const TaskAutomationServiceLive = Layer.effect(TaskAutomationService, make);
