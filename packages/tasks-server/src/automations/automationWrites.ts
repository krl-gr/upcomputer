import {
  DEFAULT_AUTOMATION_TASK_STATUS,
  type TaskAutomationStatus,
  type TaskAutomationTemplate,
  type TaskAutomationTemplateInput,
  type TaskAutomationSchedule,
} from "@t3tools/tasks-contracts/v1";
import * as Result from "effect/Result";

import { computeNextRunAt, parseAutomationCron } from "./automationSchedule.ts";

export function normalizeAutomationTemplate(
  input: TaskAutomationTemplateInput,
  existing?: TaskAutomationTemplate,
): TaskAutomationTemplate {
  return {
    title: input.title,
    description: input.description ?? existing?.description ?? "",
    status: input.status ?? existing?.status ?? DEFAULT_AUTOMATION_TASK_STATUS,
    priority: input.priority ?? existing?.priority ?? null,
    tags: input.tags ?? existing?.tags ?? [],
  };
}

/**
 * Produces the armed slot for a status transition.
 *
 * Only `enabled` automations carry a `nextRunAt`; parking one clears the slot
 * so re-enabling always arms a fresh future occurrence rather than replaying
 * whatever was pending when it was paused.
 */
export function armAutomationSchedule(
  schedule: TaskAutomationSchedule,
  status: TaskAutomationStatus,
  from: Date,
): Result.Result<string | null, string> {
  // Validate before branching on status. A draft or paused automation carries
  // no armed slot, but saving an unparseable cron only to surface the error at
  // Enable time hides the mistake from whoever typed it.
  const parsed = parseAutomationCron(schedule);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  if (status !== "enabled") return Result.succeed(null);
  const next = computeNextRunAt(schedule, from);
  return Result.isFailure(next) ? Result.fail(next.failure) : Result.succeed(next.success);
}
