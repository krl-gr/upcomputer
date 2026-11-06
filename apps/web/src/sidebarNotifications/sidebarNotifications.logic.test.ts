import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, type BackgroundNotice } from "@t3tools/contracts";

import {
  backgroundNoticeHref,
  describeSidebarNotificationsButton,
  hasFailedUpdate,
  orderNotificationCards,
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
    [[], { kind: "none" }, null, "Notifications", false],
    [[], { kind: "available" }, "neutral", "Update available", false],
    [[], { kind: "ready" }, "neutral", "Update ready", false],
    [[], { kind: "downloading", percent: 41.7 }, null, "Downloading update 41%", false],
    [["info"], { kind: "none" }, "neutral", "1 notification", false],
    [["info", "warning"], { kind: "none" }, "warning", "2 notifications", false],
    [
      ["warning", "error", "info"],
      { kind: "ready" },
      "error",
      "3 notifications, update ready",
      false,
    ],
    [
      ["warning"],
      { kind: "downloading", percent: null },
      "warning",
      "1 notification, downloading update",
      false,
    ],
    // A failed check, download or provider update shows as an error, whatever else waits.
    [[], { kind: "none" }, "error", "Update failed", true],
    [
      ["warning"],
      { kind: "available" },
      "error",
      "1 notification, update failed, update available",
      true,
    ],
  ] as const)("%j with %j shows a %s dot", (severities, update, dot, label, updateFailed) => {
    expect(
      describeSidebarNotificationsButton({
        severities,
        update,
        updateFailed,
      }),
    ).toEqual({ dot, label });
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

describe("hasFailedUpdate", () => {
  const app = { title: "", detail: "", action: null } as const;
  const machine = (result: "done" | "failed" | null) => ({
    environmentId: EnvironmentId.make("env-1"),
    label: "Studio",
    updatesProviders: false,
    server: null,
    handedOffVersion: null,
    startedAt: 0,
    result,
    failure: null,
    providerFailure: null,
  });
  const run = (phase: "servers" | "countdown", ...results: Array<"done" | "failed" | null>) => ({
    localVersion: null,
    phase,
    restartAt: null,
    machines: results.map(machine),
  });
  it.each([
    [{ app: { ...app, kind: "failed" }, providerStatuses: [], run: null }, true],
    [{ app: { ...app, kind: "available" }, providerStatuses: ["failed"], run: null }, true],
    [
      { app: { ...app, kind: "available" }, providerStatuses: ["running", undefined], run: null },
      false,
    ],
    // Update everything stands in for the other cards: failed only once every machine answered.
    [
      { app: { ...app, kind: "failed" }, providerStatuses: [], run: run("servers", "done", null) },
      false,
    ],
    [{ app: null, providerStatuses: [], run: run("servers", "done", "failed") }, true],
    [{ app: null, providerStatuses: [], run: run("countdown", "failed") }, false],
  ] as const)("%j", (input, failed) => {
    expect(hasFailedUpdate(input)).toBe(failed);
  });
});

describe("orderNotificationCards", () => {
  it("puts errors, warnings, updates, then info first, newest first, untimed cards in order", () => {
    const cards = [
      { key: "info", rank: "info", occurredAt: "2026-10-28T10:00:00.000Z" },
      { key: "app", rank: "update", occurredAt: null },
      { key: "provider", rank: "update", occurredAt: null },
      { key: "old-error", rank: "error", occurredAt: "2026-10-28T08:00:00.000Z" },
      { key: "failed-update", rank: "error", occurredAt: null },
      { key: "warning", rank: "warning", occurredAt: "2026-10-28T07:00:00.000Z" },
      { key: "new-error", rank: "error", occurredAt: "2026-10-28T09:00:00.000Z" },
    ] as const;
    expect(orderNotificationCards(cards).map((card) => card.key)).toEqual([
      "new-error",
      "old-error",
      "failed-update",
      "warning",
      "app",
      "provider",
      "info",
    ]);
  });
});
