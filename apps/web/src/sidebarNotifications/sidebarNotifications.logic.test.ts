import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, type BackgroundNotice } from "@t3tools/contracts";

import {
  backgroundNoticeHref,
  describeSidebarNotificationsButton,
  resolveSidebarUpdateSignal,
  visibleBackgroundNotices,
} from "./sidebarNotifications.logic";

const notice = (id: string, occurredAt: string): BackgroundNotice => ({
  id,
  area: "automations",
  severity: "error",
  title: "Automation turned off",
  message: "Daily report was turned off after 5 failed runs.",
  occurredAt,
});

describe("visibleBackgroundNotices", () => {
  it("merges every computer's notices newest first and hides dismissed occurrences", () => {
    const older = notice("a", "2026-10-28T08:00:00.000Z");
    const newer = notice("b", "2026-10-28T09:00:00.000Z");
    expect(visibleBackgroundNotices([[older], undefined, [newer]], new Set())).toEqual([
      newer,
      older,
    ]);
    expect(
      visibleBackgroundNotices([[older, newer]], new Set(["a@2026-10-28T08:00:00.000Z"])),
    ).toEqual([newer]);
    // The same problem happening again shows again.
    const repeat = notice("a", "2026-10-28T10:00:00.000Z");
    expect(visibleBackgroundNotices([[repeat]], new Set(["a@2026-10-28T08:00:00.000Z"]))).toEqual([
      repeat,
    ]);
  });
});

describe("backgroundNoticeHref", () => {
  it("opens the link on the computer the notice came from, keeping its own query", () => {
    expect(backgroundNoticeHref("/bots?bot=bot%3Aa", EnvironmentId.make("env-1"))).toBe(
      "/bots?bot=bot%3Aa&environment=env-1",
    );
  });
});

describe("describeSidebarNotificationsButton", () => {
  it.each([
    [[], { kind: "none" }, null, "Notifications"],
    [[], { kind: "available" }, "neutral", "Update available"],
    [[], { kind: "ready" }, "neutral", "Update ready"],
    [[], { kind: "downloading", percent: 41.7 }, null, "Downloading update 41%"],
    [["info"], { kind: "none" }, "neutral", "1 notification"],
    [["info", "warning"], { kind: "none" }, "warning", "2 notifications"],
    [["warning", "error", "info"], { kind: "ready" }, "error", "3 notifications, update ready"],
    [
      ["warning"],
      { kind: "downloading", percent: null },
      "warning",
      "1 notification, downloading update",
    ],
  ] as const)("%j with %j shows a %s dot", (severities, update, dot, label) => {
    expect(describeSidebarNotificationsButton({ severities, update })).toEqual({ dot, label });
  });
});

describe("resolveSidebarUpdateSignal", () => {
  const idle = { status: "idle", downloadPercent: null } as const;
  it.each([
    [{ state: idle, action: "none", hasOtherUpdates: false, running: false }, { kind: "none" }],
    [{ state: null, action: "none", hasOtherUpdates: true, running: false }, { kind: "available" }],
    [
      { state: idle, action: "download", hasOtherUpdates: false, running: false },
      { kind: "available" },
    ],
    [{ state: idle, action: "install", hasOtherUpdates: true, running: false }, { kind: "ready" }],
    [
      {
        state: { status: "downloading", downloadPercent: 12 },
        action: "none",
        hasOtherUpdates: true,
        running: false,
      },
      { kind: "downloading", percent: 12 },
    ],
    // The run's capsule shows its progress, so the button stays quiet.
    [{ state: idle, action: "install", hasOtherUpdates: true, running: true }, { kind: "none" }],
  ] as const)("%j", (input, signal) => {
    expect(resolveSidebarUpdateSignal(input)).toEqual(signal);
  });
});
