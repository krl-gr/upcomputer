import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import * as Result from "effect/Result";

import {
  AUTOMATION_CATCH_UP_GRACE_MS,
  computeNextRunAt,
  decideAutomationSlot,
  parseAutomationCron,
} from "./automationSchedule.ts";

const BERLIN_NINE_AM = { cron: "0 9 * * *", timezone: "Europe/Berlin" };

function automation(
  nextRunAt: string | null,
  catchUpPolicy: "skip" | "fire-once" = "fire-once",
  schedule = BERLIN_NINE_AM,
) {
  return { schedule, catchUpPolicy, nextRunAt } as const;
}

test("a schedule is read in its own time zone across daylight saving", () => {
  const summer = computeNextRunAt(BERLIN_NINE_AM, new Date("2026-07-15T00:00:00.000Z"));
  const winter = computeNextRunAt(BERLIN_NINE_AM, new Date("2026-01-15T00:00:00.000Z"));

  NodeAssert.equal(Result.isSuccess(summer), true);
  NodeAssert.equal(Result.isSuccess(winter), true);
  // 09:00 Berlin is 07:00Z under CEST and 08:00Z under CET. Storing the zone
  // rather than a fixed offset is what keeps both correct.
  NodeAssert.equal(Result.getOrNull(summer), "2026-07-15T07:00:00.000Z");
  NodeAssert.equal(Result.getOrNull(winter), "2026-01-15T08:00:00.000Z");
});

test("an unparseable schedule reports a failure instead of throwing", () => {
  const parsed = parseAutomationCron({ cron: "not a cron", timezone: "UTC" });
  NodeAssert.equal(Result.isFailure(parsed), true);

  const unknownZone = parseAutomationCron({ cron: "0 9 * * *", timezone: "Mars/Olympus" });
  NodeAssert.equal(Result.isFailure(unknownZone), true);

  const decision = decideAutomationSlot(
    automation("2026-07-15T07:00:00.000Z", "fire-once", { cron: "nope", timezone: "UTC" }),
    new Date("2026-07-15T07:00:30.000Z"),
  );
  NodeAssert.equal(decision.kind, "invalid");
});

test("an automation with no armed slot is armed without firing", () => {
  const decision = decideAutomationSlot(automation(null), new Date("2026-07-15T06:00:00.000Z"));

  NodeAssert.equal(decision.kind, "not-due");
  NodeAssert.equal(
    decision.kind === "not-due" ? decision.nextRunAt : null,
    "2026-07-15T07:00:00.000Z",
  );
});

test("a slot in the future does not fire and keeps its armed time", () => {
  const decision = decideAutomationSlot(
    automation("2026-07-15T07:00:00.000Z"),
    new Date("2026-07-15T06:59:00.000Z"),
  );

  NodeAssert.equal(decision.kind, "not-due");
  NodeAssert.equal(
    decision.kind === "not-due" ? decision.nextRunAt : null,
    "2026-07-15T07:00:00.000Z",
  );
});

test("a slot observed inside the grace window fires under either catch-up policy", () => {
  const observedAt = new Date(
    Date.parse("2026-07-15T07:00:00.000Z") + AUTOMATION_CATCH_UP_GRACE_MS,
  );

  for (const policy of ["skip", "fire-once"] as const) {
    const decision = decideAutomationSlot(
      automation("2026-07-15T07:00:00.000Z", policy),
      observedAt,
    );
    NodeAssert.equal(decision.kind, "fire", `policy ${policy} should fire on time`);
    NodeAssert.equal(decision.kind === "fire" ? decision.slot : null, "2026-07-15T07:00:00.000Z");
  }
});

test("a long outage is replayed once or skipped according to the catch-up policy", () => {
  // Three days of missed slots, as if the machine had been powered off.
  const wokeUpAt = new Date("2026-07-18T12:00:00.000Z");

  const fireOnce = decideAutomationSlot(
    automation("2026-07-15T07:00:00.000Z", "fire-once"),
    wokeUpAt,
  );
  NodeAssert.equal(fireOnce.kind, "fire");
  NodeAssert.equal(fireOnce.kind === "fire" ? fireOnce.slot : null, "2026-07-15T07:00:00.000Z");
  // The backlog is not replayed slot by slot: the schedule re-arms ahead of now.
  NodeAssert.equal(
    fireOnce.kind === "fire" ? fireOnce.nextRunAt : null,
    "2026-07-19T07:00:00.000Z",
  );

  const skipped = decideAutomationSlot(automation("2026-07-15T07:00:00.000Z", "skip"), wokeUpAt);
  NodeAssert.equal(skipped.kind, "skip-catch-up");
  NodeAssert.equal(
    skipped.kind === "skip-catch-up" ? skipped.nextRunAt : null,
    "2026-07-19T07:00:00.000Z",
  );
});

test("a corrupt armed timestamp re-arms instead of firing", () => {
  const decision = decideAutomationSlot(
    automation("definitely-not-a-date"),
    new Date("2026-07-15T12:00:00.000Z"),
  );

  NodeAssert.equal(decision.kind, "not-due");
  NodeAssert.equal(
    decision.kind === "not-due" ? decision.nextRunAt : null,
    "2026-07-16T07:00:00.000Z",
  );
});
