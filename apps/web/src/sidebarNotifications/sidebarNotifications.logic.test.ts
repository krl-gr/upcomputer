import { gtFallback } from "gt-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, type BackgroundNotice } from "@t3tools/contracts";

import {
  backgroundNoticeHref,
  describeSidebarNotificationsButton,
  hasFailedUpdate,
  orderNotificationCards,
  isComputerOutage,
  resolveSidebarUpdateSignal,
  shownComputerOutages,
  trackComputerOutages,
  visibleBackgroundNotices,
  withoutUnreachableComputers,
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

describe("computer outages", () => {
  const mini = EnvironmentId.make("mini");
  const laptop = EnvironmentId.make("laptop");

  it("counts only a computer the client keeps failing to reach", () => {
    const outage = (phase: EnvironmentConnectionPhase) => isComputerOutage({ phase });
    expect((["connecting", "reconnecting", "error", "offline"] as const).every(outage)).toBe(true);
    // Switched off, connected, or too old to connect: no outage card.
    expect((["available", "connected", "unsupported"] as const).some(outage)).toBe(false);
    // Reachable, waiting for the user to approve this device on the host.
    expect(isComputerOutage({ phase: "reconnecting", awaitingApproval: true })).toBe(false);
  });

  it("keeps each outage's start until the computer is back", () => {
    const first = trackComputerOutages(
      new Map(),
      [
        { environmentId: mini, unreachable: true },
        { environmentId: laptop, unreachable: false },
      ],
      1_000,
    );
    expect([...first]).toEqual([[mini, 1_000]]);
    const later = trackComputerOutages(
      first,
      [
        { environmentId: mini, unreachable: true },
        { environmentId: laptop, unreachable: true },
      ],
      5_000,
    );
    expect([...later]).toEqual([
      [mini, 1_000],
      [laptop, 5_000],
    ]);
    // Nothing changed: the same map, so readers don't re-render.
    expect(
      trackComputerOutages(
        later,
        [
          { environmentId: mini, unreachable: true },
          { environmentId: laptop, unreachable: true },
        ],
        9_000,
      ),
    ).toBe(later);
    // Back, then gone again: a new outage with a new start.
    const back = trackComputerOutages(later, [{ environmentId: mini, unreachable: false }], 9_000);
    expect(back.size).toBe(0);
    expect([
      ...trackComputerOutages(back, [{ environmentId: mini, unreachable: true }], 12_000),
    ]).toEqual([[mini, 12_000]]);
  });

  it("shows an outage only past the grace, and says when the next one passes it", () => {
    const starts = new Map([
      [mini, 0],
      [laptop, 50_000],
    ]);
    expect(shownComputerOutages(starts, 59_999, 60_000)).toEqual({ shown: [], nextAt: 60_000 });
    expect(shownComputerOutages(starts, 60_000, 60_000)).toEqual({
      shown: [{ environmentId: mini, since: 0 }],
      nextAt: 110_000,
    });
    expect(shownComputerOutages(starts, 110_000, 60_000).nextAt).toBeNull();
  });

  it("lets an unreachable computer's one card stand for its other problems", () => {
    const bots = { environmentId: mini, id: "bots:list" };
    const tasks = { environmentId: laptop, id: "tasks:list" };
    expect(withoutUnreachableComputers([bots, tasks], new Map([[mini, 0]]))).toEqual([tasks]);
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
      describeSidebarNotificationsButton(
        {
          severities,
          update,
          updateFailed,
        },
        gtFallback,
      ),
    ).toEqual({ dot, label });
  });

  it("shows a waiting survey with a neutral dot that never outranks an alert", () => {
    expect(
      describeSidebarNotificationsButton(
        {
          severities: [],
          update: { kind: "none" },
          survey: true,
        },
        gtFallback,
      ),
    ).toEqual({ dot: "neutral", label: "Survey" });
    expect(
      describeSidebarNotificationsButton(
        {
          severities: ["warning"],
          update: { kind: "none" },
          survey: true,
        },
        gtFallback,
      ),
    ).toEqual({ dot: "warning", label: "1 notification, survey" });
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
