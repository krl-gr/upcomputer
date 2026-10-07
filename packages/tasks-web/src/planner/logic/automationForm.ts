/**
 * An automation's editable settings, as the automation window holds them
 * (moved from the former Automations page), and the upsert they save as.
 */
import type { ProjectId } from "@t3tools/contracts";
import {
  DEFAULT_AUTOMATION_TASK_STATUS,
  type TaskAutomation,
  type TaskAutomationCatchUpPolicy,
  type TaskAutomationStatus,
  type TaskAutomationUpsertInput,
} from "@t3tools/tasks-contracts/v1";

import {
  calendarScheduleFromCron,
  calendarScheduleToCron,
  type CalendarSchedule,
  type CalendarScheduleMode,
} from "../../ui/automationCalendarSchedule.ts";

export const CATCH_UP_POLICIES: ReadonlyArray<{
  readonly value: TaskAutomationCatchUpPolicy;
  readonly label: string;
}> = [
  { value: "fire-once", label: "Run once after a missed window" },
  { value: "skip", label: "Skip missed windows entirely" },
];

export const SCHEDULE_MODES: ReadonlyArray<{
  readonly value: CalendarScheduleMode;
  readonly label: string;
}> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

export const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

export const AUTOMATION_STATUS_LABELS: Record<TaskAutomationStatus, string> = {
  draft: "Draft",
  enabled: "Enabled",
  disabled: "Disabled",
};

export interface AutomationFormState {
  readonly name: string;
  readonly projectId: string | null;
  readonly schedule: CalendarSchedule;
  readonly timezone: string;
  readonly title: string;
  readonly description: string;
  readonly taskStatus: string;
  // Priority stays hidden by product design, but retaining it prevents unrelated edits from
  // clearing a value already stored on an existing automation.
  readonly priority: string;
  readonly tags: readonly string[];
  readonly catchUpPolicy: TaskAutomationCatchUpPolicy;
  readonly skipIfOpen: boolean;
}

export function hostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function emptyAutomationForm(projectId: string | null): AutomationFormState {
  return {
    name: "",
    projectId,
    schedule: calendarScheduleFromCron("0 9 * * 1-5"),
    timezone: hostTimezone(),
    title: "",
    description: "",
    taskStatus: DEFAULT_AUTOMATION_TASK_STATUS,
    priority: "",
    tags: [],
    catchUpPolicy: "fire-once",
    skipIfOpen: true,
  };
}

export function automationFormOf(automation: TaskAutomation): AutomationFormState {
  return {
    name: automation.name,
    projectId: automation.projectId,
    schedule: calendarScheduleFromCron(automation.schedule.cron),
    timezone: automation.schedule.timezone,
    title: automation.template.title,
    description: automation.template.description,
    taskStatus: automation.template.status,
    priority: automation.template.priority ?? "",
    tags: automation.template.tags,
    catchUpPolicy: automation.catchUpPolicy,
    skipIfOpen: automation.skipIfOpen,
  };
}

export function automationScheduleError(form: AutomationFormState): string | null {
  if (!form.timezone.trim()) return "Enter a time zone.";
  if (form.schedule.mode === "weekly" && form.schedule.weekdays.length === 0) {
    return "Choose at least one day.";
  }
  if (calendarScheduleToCron(form.schedule) !== null) return null;
  return form.schedule.mode === "custom"
    ? "Enter a valid 5- or 6-field cron expression."
    : "Enter a valid schedule.";
}

/**
 * The upsert a form saves as, or why it cannot be saved. Saving never changes
 * whether an automation runs: an existing one keeps its status, and a new one
 * starts disabled until the person enables it.
 */
export function automationUpsertOf(
  form: AutomationFormState,
  existing: Pick<TaskAutomation, "id" | "status"> | null,
): { readonly input: TaskAutomationUpsertInput } | { readonly error: string } {
  const name = form.name.trim();
  const title = form.title.trim();
  const timezone = form.timezone.trim();
  const cron = calendarScheduleToCron(form.schedule);
  const scheduleError = automationScheduleError(form);
  if (!form.projectId) return { error: "Select a project" };
  if (!name) return { error: "Automation name is required" };
  if (!title) return { error: "Task title is required" };
  if (scheduleError || !cron) return { error: scheduleError ?? "Enter a valid schedule" };
  return {
    input: {
      ...(existing ? { id: existing.id } : {}),
      projectId: form.projectId as ProjectId,
      name,
      status: existing ? existing.status : "disabled",
      schedule: { cron, timezone },
      template: {
        title,
        description: form.description,
        status: form.taskStatus.trim() || DEFAULT_AUTOMATION_TASK_STATUS,
        priority: form.priority.trim() || null,
        tags: [...form.tags],
      },
      catchUpPolicy: form.catchUpPolicy,
      skipIfOpen: form.skipIfOpen,
    },
  };
}

/** A time today, else a short date (and the year when it is not this year). */
export function shortDateTime(value: string, now = new Date()): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();
  const time = parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const date = parsed.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(parsed.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date} ${time}`;
}
