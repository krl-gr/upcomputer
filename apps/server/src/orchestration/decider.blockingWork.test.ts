import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@upcomputer/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const FUTURE_WAKE = "2099-01-01T00:00:00.000Z";

function makeReadModel(
  session: OrchestrationSession | null = null,
  activities: OrchestrationThread["activities"] = [],
  messages: OrchestrationThread["messages"] = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        deletedAt: null,
        messages,
        proposedPlans: [],
        activities,
        checkpoints: [],
        session,
      },
    ],
    updatedAt: NOW,
  };
}

function makeSession(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "Codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("decider blocking-work checks", (it) => {
  it.effect("clears an open request when its respond failure marks it stale", () =>
    Effect.gen(function* () {
      const activity = (
        kind: string,
        requestId: string,
        payload: Record<string, unknown>,
      ): OrchestrationThread["activities"][number] =>
        ({
          id: EventId.make(`activity-${requestId}-${kind}`),
          tone: "approval" as const,
          kind,
          summary: kind,
          payload: { requestId, ...payload },
          turnId: null,
          createdAt: NOW,
        }) as OrchestrationThread["activities"][number];

      // Stale-failure detail clears the request — mirrors the projection's
      // pending accounting, which is what the client's canSnooze sees.
      const snoozed = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-stale-failed"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel(null, [
          activity("approval.requested", "req-1", {}),
          activity("provider.approval.respond.failed", "req-1", {
            detail: "Unknown pending approval request req-1",
          }),
          activity("user-input.requested", "req-2", {}),
          activity("provider.user-input.respond.failed", "req-2", {
            detail: "stale pending user-input request req-2",
          }),
        ]),
      });
      const snoozedEvents = Array.isArray(snoozed) ? snoozed : [snoozed];
      expect(snoozedEvents[0]?.type).toBe("thread.snoozed");

      // A non-stale respond failure (transient provider error) keeps the
      // request open: the user can retry, so it is still blocked-on-you.
      const stillOpen = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-transient-failed"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel(null, [
          activity("approval.requested", "req-3", {}),
          activity("provider.approval.respond.failed", "req-3", {
            detail: "provider connection reset",
          }),
        ]),
      }).pipe(Effect.flip);
      expect(stillOpen._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("routes approval decisions only to an open request on the selected thread", () =>
    Effect.gen(function* () {
      const requestId = ApprovalRequestId.make("req-open");
      const request = {
        id: EventId.make("activity-open-approval"),
        tone: "approval" as const,
        kind: "approval.requested",
        summary: "Approval requested",
        payload: { requestId },
        turnId: null,
        createdAt: NOW,
      } satisfies OrchestrationThread["activities"][number];

      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.approval.respond",
          commandId: CommandId.make("cmd-approval-open"),
          threadId: ThreadId.make("thread-1"),
          requestId,
          decision: "decline",
          createdAt: NOW,
        },
        readModel: makeReadModel(makeSession("running"), [request]),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.approval-response-requested");

      const staleError = yield* decideOrchestrationCommand({
        command: {
          type: "thread.approval.respond",
          commandId: CommandId.make("cmd-approval-stale"),
          threadId: ThreadId.make("thread-1"),
          requestId: ApprovalRequestId.make("req-stale"),
          decision: "accept",
          createdAt: NOW,
        },
        readModel: makeReadModel(makeSession("running"), [request]),
      }).pipe(Effect.flip);
      expect(staleError._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("bounds the queued-turn grace window against client clock skew", () =>
    Effect.gen(function* () {
      const userMessage = (createdAt: string): OrchestrationThread["messages"][number] => ({
        id: MessageId.make("message-queued"),
        role: "user",
        text: "Continue",
        turnId: null,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      });

      // The decider's clock is the Effect test clock, pinned to the epoch:
      // timestamps here are relative to 1970-01-01T00:00:00.000Z.

      // Within the grace window: genuinely queued, snooze rejected.
      const queuedError = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-queued"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel(null, [], [userMessage("1969-12-31T23:59:30.000Z")]),
      }).pipe(Effect.flip);
      expect(queuedError._tag).toBe("OrchestrationCommandInvariantError");

      // Message timestamp far in the FUTURE (client clock ahead of server):
      // a negative age must not read as queued forever — past the grace
      // bound in either direction the thread is snoozable.
      const skewed = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-skewed"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel(null, [], [userMessage("1970-01-01T01:00:00.000Z")]),
      });
      const skewedEvents = Array.isArray(skewed) ? skewed : [skewed];
      expect(skewedEvents[0]?.type).toBe("thread.snoozed");
    }),
  );

  it.effect("invalidates open approvals when a provider session becomes terminal", () =>
    Effect.gen(function* () {
      const requestId = ApprovalRequestId.make("req-orphaned");
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-interrupted"),
          threadId: ThreadId.make("thread-1"),
          session: makeSession("interrupted"),
          createdAt: NOW,
        },
        readModel: makeReadModel(makeSession("running"), [
          {
            id: EventId.make("activity-orphaned-approval"),
            tone: "approval",
            kind: "approval.requested",
            summary: "File-change approval requested",
            payload: { requestId, requestKind: "file-change" },
            turnId: null,
            createdAt: NOW,
          },
        ]),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.session-set",
        "thread.activity-appended",
      ]);
      expect(events[1]?.payload).toMatchObject({
        activity: {
          kind: "approval.resolved",
          payload: { requestId, invalidated: true },
        },
      });

      const staleDecision = yield* decideOrchestrationCommand({
        command: {
          type: "thread.approval.respond",
          commandId: CommandId.make("cmd-orphaned-approval-response"),
          threadId: ThreadId.make("thread-1"),
          requestId,
          decision: "accept",
          createdAt: NOW,
        },
        readModel: makeReadModel(makeSession("interrupted"), [
          {
            id: EventId.make("activity-orphaned-approval"),
            tone: "approval",
            kind: "approval.requested",
            summary: "File-change approval requested",
            payload: { requestId, requestKind: "file-change" },
            turnId: null,
            createdAt: NOW,
          },
          {
            id: EventId.make("activity-orphaned-approval-invalidated"),
            tone: "approval",
            kind: "approval.resolved",
            summary: "Approval invalidated",
            payload: { requestId, invalidated: true },
            turnId: null,
            createdAt: NOW,
          },
        ]),
      }).pipe(Effect.flip);
      expect(staleDecision._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
