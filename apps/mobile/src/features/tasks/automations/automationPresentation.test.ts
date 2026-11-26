import { gtFallback } from "gt-react-native";
import { describe, expect, it } from "vite-plus/test";

import type { MessageResolver } from "../../../i18n/messages";
import { automationScheduleLine, describeAutomationSchedule } from "./automationPresentation";

const english = ((message: string, variables?: Record<string, unknown>) =>
  gtFallback(message, { ...variables, $locale: "en-US" })) as MessageResolver;

describe("automation schedule", () => {
  it("words the desktop's daily, weekly, monthly and custom schedules", () => {
    expect(describeAutomationSchedule("0 8 * * *", english)).toBe("Every day at 08:00");
    expect(describeAutomationSchedule("0 9 * * 1,5", english)).toBe(
      "Every week on Mo, Fr at 09:00",
    );
    expect(describeAutomationSchedule("0 9 * * 0-6", english)).toBe(
      "Every week on every day at 09:00",
    );
    expect(describeAutomationSchedule("15 8 2 * *", english)).toBe("Monthly on the 2nd at 08:15");
    expect(describeAutomationSchedule("*/5 * * * *", english)).toBe(
      "Custom schedule · */5 * * * *",
    );
  });

  it("adds the next run only while enabled", () => {
    const automation = {
      schedule: { cron: "0 8 * * *", timezone: "UTC" },
      nextRunAt: "2026-11-27T08:00:00.000Z",
    };
    const now = new Date("2026-11-26T12:00:00.000Z");
    expect(
      automationScheduleLine({ ...automation, status: "enabled" }, english, "en-US", now),
    ).toMatch(/^Every day at 08:00 · next Nov 27/);
    expect(
      automationScheduleLine({ ...automation, status: "disabled" }, english, "en-US", now),
    ).toBe("Every day at 08:00");
  });
});
