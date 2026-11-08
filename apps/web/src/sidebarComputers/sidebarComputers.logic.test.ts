import { threadKey } from "@t3tools/client-runtime/state/entities";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import {
  computerRunCountGroups,
  computerShortcutChoice,
  countComputerRuns,
  filterToComputerScope,
  projectKeysInComputerScope,
  resolveComputerSelection,
} from "./sidebarComputers.logic";

const mac = EnvironmentId.make("env-mac");
const studio = EnvironmentId.make("env-studio");
const mini = EnvironmentId.make("env-mini");

const route = (environmentId: EnvironmentId, threadId = "thread-1") => ({
  key: `${environmentId}:${threadId}`,
  environmentId,
});

describe("resolveComputerSelection", () => {
  const base = {
    saved: null,
    computerIds: [mac, studio],
    primaryId: mac,
    route: null,
    revealedRouteKey: null,
  } as const;

  it("hides the section and filters nothing with one computer", () => {
    const selection = resolveComputerSelection({ ...base, saved: studio, computerIds: [mac] });
    expect(selection).toEqual({ shown: false, choice: "all", revealsRoute: false });
    expect(filterToComputerScope([{ environmentId: mac }], null)).toHaveLength(1);
  });

  it("defaults to this computer and falls back to it when the saved one is gone", () => {
    expect(resolveComputerSelection(base).choice).toBe(mac);
    expect(resolveComputerSelection({ ...base, saved: mini }).choice).toBe(mac);
    expect(resolveComputerSelection({ ...base, saved: studio }).choice).toBe(studio);
    expect(resolveComputerSelection({ ...base, saved: "all" }).choice).toBe("all");
  });

  it("follows a newly opened thread on another computer, once per route", () => {
    const opened = resolveComputerSelection({ ...base, route: route(studio) });
    expect(opened).toEqual({ shown: true, choice: studio, revealsRoute: true });
    // After the reveal is recorded, a later pick of This Mac holds while the thread stays open.
    expect(
      resolveComputerSelection({
        ...base,
        route: route(studio),
        revealedRouteKey: route(studio).key,
      }).choice,
    ).toBe(mac);
    // All computers already lists the thread; an unknown computer is not followed.
    expect(resolveComputerSelection({ ...base, saved: "all", route: route(studio) }).choice).toBe(
      "all",
    );
    expect(resolveComputerSelection({ ...base, route: route(mini) }).choice).toBe(mac);
  });
});

function shell(
  environmentId: EnvironmentId,
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
) {
  return presentThreadShell(environmentId, {
    ...makeThreadFixture().source,
    id: ThreadId.make(id),
    ...overrides,
  });
}

const failedAt = DateTime.makeUnsafe("2026-06-20T01:00:00.000Z");
const failed = (visitedAt: string | null): Partial<OrchestrationV2ThreadShell> => ({
  latestRunId: RunId.make("run-failed"),
  status: "failed",
  latestRunCompletedAt: failedAt,
  lastVisitedAt: visitedAt === null ? null : DateTime.makeUnsafe(visitedAt),
});
const request = (kind: "user_input" | "command") => ({
  latestRunId: RunId.make("run-request"),
  status: "running" as const,
  activityRunStatus: "running" as const,
  pendingRuntimeRequest: {
    id: RuntimeRequestId.make(`request-${kind}`),
    kind,
    createdAt: failedAt,
  },
});

describe("countComputerRuns", () => {
  it("counts working, waiting and unseen failed runs per computer, like their rows", () => {
    const counts = countComputerRuns(
      [
        shell(mac, "working", {
          latestRunId: RunId.make("run-working"),
          status: "running",
          activityRunStatus: "running",
        }),
        shell(studio, "input", request("user_input")),
        shell(studio, "approval", request("command")),
        shell(studio, "failed-unseen", failed(null)),
        shell(studio, "failed-seen", failed("2026-06-20T02:00:00.000Z")),
        shell(studio, "failed-before-visit", failed("2026-06-20T00:30:00.000Z")),
        shell(studio, "archived", { ...failed(null), archivedAt: failedAt }),
        // A task agent run's thread is hidden from the sidebar; Tasks shows its result.
        shell(studio, "task-run", { ...request("user_input"), sidebarHidden: true }),
        shell(studio, "delegated", failed(null)),
      ],
      new Set([threadKey({ environmentId: studio, threadId: ThreadId.make("delegated") })]),
      {},
    );
    expect(counts.get(mac)).toEqual({ working: 1, input: 0, approval: 0, failed: 0 });
    expect(counts.get(studio)).toEqual({ working: 0, input: 1, approval: 1, failed: 2 });
    // Each computer's row shows them in the run count badge's order, without zeros.
    expect(
      computerRunCountGroups(counts.get(studio)!).map(({ label, count }) => [label, count]),
    ).toEqual([
      ["Pending Approval", 1],
      ["Awaiting Input", 1],
      ["Failed", 2],
    ]);
  });

  it("treats a local visit as seen on servers without visit tracking", () => {
    const { lastVisitedAt: _omitted, ...withoutVisits } = failed(null);
    const thread = shell(studio, "failed-local", withoutVisits);
    expect(countComputerRuns([thread], new Set(), {}).get(studio)?.failed).toBe(1);
    expect(
      countComputerRuns([thread], new Set(), {
        [`${studio}:failed-local`]: "2026-06-20T02:00:00.000Z",
      }).get(studio),
    ).toBeUndefined();
  });
});

describe("projectKeysInComputerScope", () => {
  const projects = [
    { environmentId: mac, id: "a" },
    { environmentId: studio, id: "b" },
  ];

  it("narrows the project scope to the selected computer", () => {
    const scope = new Set([studio]);
    expect(projectKeysInComputerScope({ scopedProjectKeys: null, projects, scope })).toEqual(
      new Set([`${studio}:b`]),
    );
    expect(
      projectKeysInComputerScope({ scopedProjectKeys: new Set([`${mac}:a`]), projects, scope }),
    ).toEqual(new Set());
    expect(projectKeysInComputerScope({ scopedProjectKeys: null, projects, scope: null })).toBe(
      null,
    );
  });
});

describe("computerShortcutChoice", () => {
  const key = (
    digit: string,
    modifiers: Partial<Record<"ctrlKey" | "altKey" | "metaKey" | "shiftKey", boolean>>,
  ) => ({
    key: digit,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  });

  it("maps Ctrl+digit on macOS and Ctrl+Alt+digit elsewhere", () => {
    const ids = [mac, studio];
    expect(computerShortcutChoice(key("2", { ctrlKey: true }), ids, true)).toBe(studio);
    expect(computerShortcutChoice(key("0", { ctrlKey: true }), ids, true)).toBe("all");
    expect(computerShortcutChoice(key("3", { ctrlKey: true }), ids, true)).toBeNull();
    // Cmd+digit is the thread jump on macOS.
    expect(computerShortcutChoice(key("1", { metaKey: true }), ids, true)).toBeNull();
    expect(computerShortcutChoice(key("1", { ctrlKey: true }), ids, false)).toBeNull();
    expect(computerShortcutChoice(key("1", { ctrlKey: true, altKey: true }), ids, false)).toBe(mac);
  });
});
