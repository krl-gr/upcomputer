import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  calendarScheduleFromCron,
  calendarScheduleToCron,
  describeCron,
} from "./automationCalendarSchedule.ts";

test("calendar schedules parse the common daily, weekly, and monthly cron shapes", () => {
  NodeAssert.deepEqual(calendarScheduleFromCron("0 9 * * *"), {
    mode: "daily",
    time: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    monthDay: 1,
    customCron: "0 9 * * *",
  });
  NodeAssert.equal(calendarScheduleFromCron("30 18 * * 1-5").mode, "weekly");
  NodeAssert.deepEqual(calendarScheduleFromCron("30 18 * * 1-5").weekdays, [1, 2, 3, 4, 5]);
  NodeAssert.deepEqual(calendarScheduleFromCron("15 8 12 * *"), {
    mode: "monthly",
    time: "08:15",
    weekdays: [1, 2, 3, 4, 5],
    monthDay: 12,
    customCron: "15 8 12 * *",
  });
});

test("calendar schedules generate canonical cron expressions", () => {
  NodeAssert.equal(
    calendarScheduleToCron({
      mode: "weekly",
      time: "09:05",
      weekdays: [5, 1, 3],
      monthDay: 1,
      customCron: "",
    }),
    "5 9 * * 1,3,5",
  );
  NodeAssert.equal(
    calendarScheduleToCron({
      mode: "monthly",
      time: "18:30",
      weekdays: [],
      monthDay: 31,
      customCron: "",
    }),
    "30 18 31 * *",
  );
});

test("unsupported expressions stay losslessly editable as custom schedules", () => {
  const cron = "0 */2 * * *";
  const schedule = calendarScheduleFromCron(cron);
  NodeAssert.equal(schedule.mode, "custom");
  NodeAssert.equal(schedule.customCron, cron);
  NodeAssert.equal(calendarScheduleToCron(schedule), cron);
});

test("human descriptions replace cron on automation cards", () => {
  NodeAssert.equal(describeCron("0 9 * * 1-5"), "Every week on Mo, Tu, We, Th, Fr at 09:00");
  NodeAssert.equal(describeCron("30 8 2 * *"), "Monthly on the 2nd at 08:30");
});
