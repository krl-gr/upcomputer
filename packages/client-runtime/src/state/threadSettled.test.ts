import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
} from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hasQueuedTurnStart } from "./threadSettled.ts";

const NOW = "2026-04-10T00:00:00.000Z";
const FRESH = "2026-04-09T00:00:00.000Z";

function makeShell(input: { readonly activityAt: string | null }): OrchestrationThreadShell {
  const threadId = ThreadId.make("thread-1");
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn:
      input.activityAt === null
        ? null
        : {
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: input.activityAt,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: NOW,
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

describe("hasQueuedTurnStart", () => {
  const QUEUED_AT = "2026-04-09T12:00:00.000Z";
  // Within the adoption grace window of the queued message.
  const JUST_AFTER = { now: "2026-04-09T12:00:30.000Z" };

  it("flags a user message no turn has picked up, within the grace window", () => {
    const noTurn = { latestUserMessageAt: QUEUED_AT, latestTurn: null, session: null };
    expect(hasQueuedTurnStart(noTurn, JUST_AFTER)).toBe(true);

    const staleTurn = {
      ...makeShell({ activityAt: FRESH }),
      latestUserMessageAt: QUEUED_AT,
    };
    expect(hasQueuedTurnStart(staleTurn, JUST_AFTER)).toBe(true);
  });

  it("expires after the grace window: an unadopted message is a failed start, not queued work", () => {
    const noTurn = { latestUserMessageAt: QUEUED_AT, latestTurn: null, session: null };
    expect(hasQueuedTurnStart(noTurn, { now: "2026-04-09T12:03:00.000Z" })).toBe(false);
    // Historical shells (e.g. from servers that never carried latestTurn)
    // must never read as queued.
    expect(hasQueuedTurnStart(noTurn, { now: NOW })).toBe(false);
  });

  it("clears once a turn adopts the message or the start fails", () => {
    const adopted = {
      ...makeShell({ activityAt: QUEUED_AT }),
      latestUserMessageAt: QUEUED_AT,
    };
    expect(hasQueuedTurnStart(adopted, JUST_AFTER)).toBe(false);

    const failed = makeShell({ activityAt: FRESH });
    const failedShell = {
      ...failed,
      latestUserMessageAt: QUEUED_AT,
      session: {
        threadId: failed.id,
        status: "error" as const,
        providerName: "Codex",
        runtimeMode: "full-access" as const,
        activeTurnId: null,
        lastError: "boom",
        updatedAt: NOW,
      },
    };
    expect(hasQueuedTurnStart(failedShell, JUST_AFTER)).toBe(false);
  });

  it("is quiet without user messages", () => {
    expect(hasQueuedTurnStart(makeShell({ activityAt: FRESH }), JUST_AFTER)).toBe(false);
  });

  it("bounds the grace window in both directions: a future-stamped message is skew, not queued work", () => {
    // Message timestamps originate on other devices; a clock an hour ahead
    // must not hold the queued state for the whole skew.
    const skewed = {
      latestUserMessageAt: "2026-04-09T13:00:00.000Z",
      latestTurn: null,
      session: null,
    };
    expect(hasQueuedTurnStart(skewed, { now: "2026-04-09T12:00:00.000Z" })).toBe(false);
    // A small negative age (within the grace window) still reads as queued.
    const slightlyAhead = {
      latestUserMessageAt: "2026-04-09T12:00:30.000Z",
      latestTurn: null,
      session: null,
    };
    expect(hasQueuedTurnStart(slightlyAhead, { now: "2026-04-09T12:00:00.000Z" })).toBe(true);
  });
});
