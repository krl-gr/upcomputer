import type { SessionStatus } from "@opencode-ai/sdk/v2";
import type {
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderRetry,
  OrchestrationV2ProviderTurn,
  OrchestrationV2TurnItem,
  ProviderDriverKind,
} from "@t3tools/contracts";
import {
  makeProviderFailure,
  makeProviderRetryTurnItem,
} from "@t3tools/provider-core/server/failure";
import * as DateTime from "effect/DateTime";

type OpenCodeRetryStatus = Extract<SessionStatus, { readonly type: "retry" }>;

interface RetryTurn {
  readonly threadId: OrchestrationV2TurnItem["threadId"];
  readonly runId: OrchestrationV2TurnItem["runId"];
  readonly rootNodeId: OrchestrationV2TurnItem["nodeId"];
  readonly providerThreadId: OrchestrationV2ProviderTurn["providerThreadId"];
  readonly providerTurnId: OrchestrationV2ProviderTurn["id"];
}

interface RetryState {
  readonly startedAt: DateTime.Utc;
  readonly retry: OrchestrationV2ProviderRetry;
  readonly failure: OrchestrationV2ProviderFailure;
}

const retries = new WeakMap<RetryTurn, RetryState>();

/**
 * UpComputer: OpenCode's `retry` status as the provider retry item, so a waiting turn says why.
 * With `retry` it reports one; without, it ends the turn's open retry with `status`. The item
 * shares the terminal failure's id, so a failed turn replaces it.
 */
export function openCodeRetryTurnItem(input: {
  readonly driver: ProviderDriverKind;
  readonly turn: RetryTurn;
  readonly itemOrdinal: (nativeItemId: string) => number;
  readonly now: DateTime.Utc;
  readonly retry?: OpenCodeRetryStatus;
  readonly status?: "completed" | "interrupted";
}): Extract<OrchestrationV2TurnItem, { readonly type: "error" }> | undefined {
  const { driver, turn, now, retry } = input;
  let state = retries.get(turn);
  if (retry !== undefined) {
    const reason = retry.action?.reason;
    state = {
      startedAt: state?.startedAt ?? now,
      retry: {
        attempt: Math.max(1, Math.trunc(retry.attempt)),
        maxAttempts: null,
        retryDelayMs: Math.max(0, Math.trunc(retry.next - DateTime.toEpochMillis(now))),
      },
      failure: makeProviderFailure({
        driver,
        message: retry.action?.message || retry.message,
        code: reason ?? null,
        class: reason === "free_tier_limit" ? "usage_limit" : "provider_error",
        retryable: true,
      }),
    };
    retries.set(turn, state);
  } else if (state !== undefined) {
    retries.delete(turn);
  }
  if (state === undefined) return undefined;
  return makeProviderRetryTurnItem({
    driver,
    threadId: turn.threadId,
    runId: turn.runId,
    nodeId: turn.rootNodeId,
    providerThreadId: turn.providerThreadId,
    providerTurnId: turn.providerTurnId,
    itemOrdinal: input.itemOrdinal(`terminal-failure:${turn.providerTurnId}`),
    failure: state.failure,
    retry: state.retry,
    status: retry !== undefined ? "running" : (input.status ?? "completed"),
    startedAt: state.startedAt,
    updatedAt: now,
  });
}
