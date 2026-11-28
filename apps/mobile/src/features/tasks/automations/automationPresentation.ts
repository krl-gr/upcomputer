import {
  calendarScheduleFromCron,
  shortDateTime,
} from "@t3tools/tasks-client/automations/cronSchedule";
import type {
  TaskAutomation,
  TaskAutomationCatchUpPolicy,
  TaskAutomationStatus,
} from "@t3tools/tasks-contracts/v1";
import { msg } from "gt-react-native";

import type { MessageResolver } from "../../../i18n/messages";

export const AUTOMATION_STATUS_LABELS: Record<TaskAutomationStatus, string> = {
  draft: msg("Draft", { $context: "automation status" }),
  enabled: msg("Enabled", { $context: "automation status" }),
  disabled: msg("Disabled", { $context: "automation status" }),
};

export const CATCH_UP_POLICY_LABELS: Record<TaskAutomationCatchUpPolicy, string> = {
  "fire-once": msg("Run once after a missed window"),
  skip: msg("Skip missed windows entirely"),
};

/** The desktop's short weekday names, Monday first, by cron weekday number. */
const WEEKDAYS = [
  [1, msg("Mo")],
  [2, msg("Tu")],
  [3, msg("We")],
  [4, msg("Th")],
  [5, msg("Fr")],
  [6, msg("Sa")],
  [0, msg("Su")],
] as const;

/** An automation's schedule in the desktop's words. */
export function describeAutomationSchedule(cron: string, resolve: MessageResolver): string {
  const schedule = calendarScheduleFromCron(cron);
  const { time } = schedule;
  switch (schedule.mode) {
    case "custom":
      return resolve(msg("Custom schedule · {cron}"), { cron: schedule.customCron.trim() });
    case "daily":
      return resolve(msg("Every day at {time}"), { time });
    case "monthly":
      return resolve(
        msg(
          "Monthly on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} at {time}",
        ),
        { day: schedule.monthDay, time },
      );
    case "weekly": {
      const days = WEEKDAYS.filter(([value]) => schedule.weekdays.includes(value)).map(
        ([, label]) => resolve(label),
      );
      return days.length === 7
        ? resolve(msg("Every week on every day at {time}"), { time })
        : resolve(msg("Every week on {days} at {time}"), { days: days.join(", "), time });
    }
  }
}

/** The list row's schedule line: the schedule, and the next run while enabled. */
export function automationScheduleLine(
  automation: Pick<TaskAutomation, "schedule" | "status" | "nextRunAt">,
  resolve: MessageResolver,
  locale: string,
  now = new Date(),
): string {
  const schedule = describeAutomationSchedule(automation.schedule.cron, resolve);
  return automation.status === "enabled" && automation.nextRunAt
    ? resolve(msg("{schedule} · next {time}"), {
        schedule,
        time: shortDateTime(automation.nextRunAt, locale, now),
      })
    : schedule;
}
