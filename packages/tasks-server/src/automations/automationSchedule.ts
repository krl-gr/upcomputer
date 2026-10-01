import type { TaskAutomation, TaskAutomationSchedule } from "@upcomputer/tasks-contracts/v1";
import * as Cron from "effect/Cron";
import * as Result from "effect/Result";

/**
 * How late a slot may fire before it counts as a miss rather than a normal
 * tick. Without this window a coarse tick interval would make `skip` mean
 * "never fire", because every fire is observed slightly after its slot.
 */
export const AUTOMATION_CATCH_UP_GRACE_MS = 2 * 60_000;

/** Consecutive failures tolerated before an automation parks itself. */
export const AUTOMATION_FAILURE_LIMIT = 5;

export type AutomationSlotDecision =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "not-due"; readonly nextRunAt: string }
  | { readonly kind: "fire"; readonly slot: string; readonly nextRunAt: string }
  | {
      readonly kind: "skip-catch-up";
      readonly slot: string;
      readonly nextRunAt: string;
      readonly missedByMs: number;
    };

export function parseAutomationCron(
  schedule: TaskAutomationSchedule,
): Result.Result<Cron.Cron, string> {
  const parsed = Cron.parse(schedule.cron, schedule.timezone);
  return Result.isSuccess(parsed)
    ? Result.succeed(parsed.success)
    : Result.fail(
        `Invalid schedule '${schedule.cron}' for time zone '${schedule.timezone}': ${parsed.failure.message}`,
      );
}

/** Next occurrence strictly after `from`, or an error message for a bad cron. */
export function computeNextRunAt(
  schedule: TaskAutomationSchedule,
  from: Date,
): Result.Result<string, string> {
  const cron = parseAutomationCron(schedule);
  if (Result.isFailure(cron)) return Result.fail(cron.failure);
  try {
    return Result.succeed(Cron.next(cron.success, from).toISOString());
  } catch (cause) {
    return Result.fail(`Schedule '${schedule.cron}' has no upcoming occurrence: ${String(cause)}`);
  }
}

/**
 * Decides what a single scheduler pass should do with one automation.
 *
 * Kept pure so the interesting cases — a slept machine, a slot that landed
 * inside the grace window, a cron that stopped parsing after an edit — are
 * testable without a database or a clock.
 */
export function decideAutomationSlot(
  automation: Pick<TaskAutomation, "schedule" | "catchUpPolicy" | "nextRunAt">,
  now: Date,
  graceMs: number = AUTOMATION_CATCH_UP_GRACE_MS,
): AutomationSlotDecision {
  const scheduled = computeNextRunAt(automation.schedule, now);
  if (Result.isFailure(scheduled)) {
    return { kind: "invalid", message: scheduled.failure };
  }
  const upcoming = scheduled.success;

  // A freshly enabled or freshly edited automation has no armed slot yet, so
  // arm it without firing: the first fire must be a real future occurrence.
  if (automation.nextRunAt === null) {
    return { kind: "not-due", nextRunAt: upcoming };
  }

  const due = Date.parse(automation.nextRunAt);
  if (Number.isNaN(due)) {
    return { kind: "not-due", nextRunAt: upcoming };
  }

  const missedByMs = now.getTime() - due;
  if (missedByMs < 0) {
    return { kind: "not-due", nextRunAt: automation.nextRunAt };
  }

  const slot = new Date(due).toISOString();
  if (missedByMs <= graceMs || automation.catchUpPolicy === "fire-once") {
    return { kind: "fire", slot, nextRunAt: upcoming };
  }
  return { kind: "skip-catch-up", slot, nextRunAt: upcoming, missedByMs };
}

export function describeSchedule(schedule: TaskAutomationSchedule): string {
  return `${schedule.cron} (${schedule.timezone})`;
}
