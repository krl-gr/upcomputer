import { assert, it } from "@effect/vitest";

import { isTimeZone, reminderAt, scheduledInstant, type ReminderSettings } from "./reminders.ts";

const berlin: ReminderSettings = { timeZone: "Europe/Berlin", enabled: true, leadMinutes: 10 };
const now = Date.parse("2026-10-07T06:00:00.000Z");
const open = { date: "2026-10-07", startTime: "09:30", status: "open" } as const;

it("reads dates and times as wall-clock values in the schedule's zone", () => {
  // Berlin is UTC+2 in summer time.
  assert.equal(
    scheduledInstant("2026-10-07", "09:30", "Europe/Berlin"),
    Date.parse("2026-10-07T07:30:00.000Z"),
  );
  assert.equal(
    scheduledInstant("2026-10-07", "09:30", "UTC"),
    Date.parse("2026-10-07T09:30:00.000Z"),
  );
  // A skipped spring time resolves later, a repeated autumn time earlier.
  assert.equal(
    scheduledInstant("2026-03-29", "02:30", "Europe/Berlin"),
    Date.parse("2026-03-29T01:30:00.000Z"),
  );
  assert.equal(
    scheduledInstant("2026-10-25", "02:30", "Europe/Berlin"),
    Date.parse("2026-10-25T00:30:00.000Z"),
  );
  assert.equal(scheduledInstant("2026-10-07", "09:30", "Not/AZone"), null);
  assert.isTrue(isTimeZone("Asia/Tokyo"));
  assert.isFalse(isTimeZone("Not/AZone"));
});

it("reminds the lead minutes before an open timed entry starts", () => {
  assert.equal(reminderAt(open, berlin, now), "2026-10-07T07:20:00.000Z");
  assert.equal(reminderAt(open, { ...berlin, leadMinutes: 0 }, now), "2026-10-07T07:30:00.000Z");
  assert.equal(
    reminderAt(open, { ...berlin, timeZone: "America/New_York" }, now),
    "2026-10-07T13:20:00.000Z",
  );
});

it("a lead longer than the time left makes the reminder due at once", () => {
  const soon = Date.parse("2026-10-07T07:25:00.000Z");
  const at = reminderAt(open, berlin, soon);
  assert.equal(at, "2026-10-07T07:20:00.000Z");
  assert.isTrue(Date.parse(at!) <= soon);
});

it("no reminder when off, untimed, handled, started or in an unknown zone", () => {
  assert.equal(reminderAt(open, { ...berlin, enabled: false }, now), null);
  assert.equal(reminderAt({ ...open, startTime: null }, berlin, now), null);
  assert.equal(reminderAt({ ...open, status: "done" }, berlin, now), null);
  assert.equal(reminderAt({ ...open, status: "skipped" }, berlin, now), null);
  assert.equal(reminderAt(open, berlin, Date.parse("2026-10-07T07:30:00.000Z")), null);
  assert.equal(reminderAt({ ...open, date: "2026-10-06" }, berlin, now), null);
  assert.equal(reminderAt(open, { ...berlin, timeZone: "Not/AZone" }, now), null);
});
