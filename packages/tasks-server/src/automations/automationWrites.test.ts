import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import * as Result from "effect/Result";

import { armAutomationSchedule, normalizeAutomationTemplate } from "./automationWrites.ts";

const FROM = new Date("2026-07-15T00:00:00.000Z");

test("an invalid schedule is rejected whatever the status", () => {
  // The UI saves new automations as `disabled`. Validating only on the way to
  // `enabled` would let a typo sit unnoticed until the user clicks Enable.
  for (const status of ["draft", "disabled", "enabled"] as const) {
    const badCron = armAutomationSchedule({ cron: "0 99 * * *", timezone: "UTC" }, status, FROM);
    NodeAssert.equal(Result.isFailure(badCron), true, `status ${status} must reject a bad cron`);

    const badZone = armAutomationSchedule(
      { cron: "0 9 * * *", timezone: "Europe/Berlim" },
      status,
      FROM,
    );
    NodeAssert.equal(
      Result.isFailure(badZone),
      true,
      `status ${status} must reject a bad time zone`,
    );
  }
});

test("only an enabled automation is armed with a slot", () => {
  const schedule = { cron: "0 9 * * *", timezone: "UTC" };

  NodeAssert.equal(Result.getOrNull(armAutomationSchedule(schedule, "draft", FROM)), null);
  NodeAssert.equal(Result.getOrNull(armAutomationSchedule(schedule, "disabled", FROM)), null);
  NodeAssert.equal(
    Result.getOrNull(armAutomationSchedule(schedule, "enabled", FROM)),
    "2026-07-15T09:00:00.000Z",
  );
});

test("a template keeps prior values for fields the caller left out", () => {
  const existing = {
    title: "Old",
    description: "Old description",
    status: "in progress",
    priority: "high",
    tags: ["maintenance"],
  };

  const patched = normalizeAutomationTemplate({ title: "New" }, existing);
  NodeAssert.deepEqual(patched, { ...existing, title: "New" });

  const fresh = normalizeAutomationTemplate({ title: "New" });
  NodeAssert.deepEqual(fresh, {
    title: "New",
    description: "",
    status: "new",
    priority: null,
    tags: [],
  });
});
