import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type RecordedNotification = Extract<OrchestrationV2TurnItem, { readonly type: "notification" }>;

const MAX_NOTE_ENTRIES = 10;
const MAX_DETAIL_LENGTH = 2_000;

function recordedAt(item: RecordedNotification): DateTime.Utc {
  return item.startedAt ?? item.updatedAt;
}

/**
 * Notifications recorded in the thread without a run (`thread.notification.record`) that no
 * provider turn has been prompted after. A completed turn of a run that started after one
 * proves delivery, so the pending set is derived rather than cleared. Compactions and
 * restart continuations carry no note, so they neither owe nor deliver it, and a
 * rolled-back run left native history.
 */
export function pendingRecordedNotifications(input: {
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "status">
  >;
  /** Include earlier attempts: a steer replaces the attempt but not the run. */
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId">>;
  readonly compactionMessageIds: ReadonlySet<string>;
  readonly run: Pick<OrchestrationV2Run, "userMessageId" | "restartContinuationOfRunId">;
}): ReadonlyArray<RecordedNotification> {
  const isCompaction = (run: Pick<OrchestrationV2Run, "userMessageId">) =>
    input.compactionMessageIds.has(run.userMessageId);
  if (input.run.restartContinuationOfRunId !== undefined || isCompaction(input.run)) return [];
  const recorded = input.items.filter(
    (item): item is RecordedNotification => item.type === "notification" && item.runId === null,
  );
  if (recorded.length === 0) return [];
  const completedAttemptIds = new Set(
    input.providerTurns
      .filter((turn) => turn.status === "completed")
      .map((turn) => turn.runAttemptId),
  );
  const promptedRunIds = new Set(
    input.attempts
      .filter((attempt) => completedAttemptIds.has(attempt.id))
      .map((attempt) => attempt.runId),
  );
  const lastPromptedAt = input.runs
    .filter(
      (run) =>
        run.startedAt !== null &&
        run.status !== "rolled_back" &&
        run.restartContinuationOfRunId === undefined &&
        !isCompaction(run) &&
        (promptedRunIds.has(run.id) ||
          (run.activeAttemptId !== null && completedAttemptIds.has(run.activeAttemptId))),
    )
    .reduce<DateTime.Utc | null>(
      (latest, run) =>
        latest === null || DateTime.isGreaterThan(run.startedAt!, latest) ? run.startedAt : latest,
      null,
    );
  return recorded.filter(
    (item) => lastPromptedAt === null || DateTime.isGreaterThan(recordedAt(item), lastPromptedAt),
  );
}

/**
 * Provider-facing text for notifications the user saw while the agent was not prompted.
 * Bounded (entries and detail length) so it cannot crowd out the turn's context.
 */
export function recordedNotificationsNote(items: ReadonlyArray<RecordedNotification>): string {
  if (items.length === 0) return "";
  const shown = items.slice(-MAX_NOTE_ENTRIES);
  const omitted = items.length - shown.length;
  return [
    "Note: these notifications were shown in this thread since your last turn. You were not asked to act on them then:",
    ...(omitted > 0 ? [`- ${omitted} earlier notifications omitted`] : []),
    ...shown.map((item) => {
      const detail = item.detail?.trim();
      if (detail === undefined || detail.length === 0) return `- ${item.summary}`;
      const clipped =
        detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH - 1)}…` : detail;
      return `- ${item.summary}\n${clipped
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}`;
    }),
  ].join("\n");
}
