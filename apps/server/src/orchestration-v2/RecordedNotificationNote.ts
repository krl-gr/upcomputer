import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";

type RecordedNotification = Extract<OrchestrationV2TurnItem, { readonly type: "notification" }>;

const MAX_NOTE_ENTRIES = 10;
const MAX_DETAIL_LENGTH = 2_000;

/**
 * Notifications recorded in the thread without a run (`thread.notification.record`) that no
 * prompt has delivered yet. An attempt names the notifications its prompt carried, and a
 * completed provider turn of that attempt delivers them, so the pending set is derived
 * rather than cleared. A rolled-back run left native history.
 */
export function pendingRecordedNotifications(input: {
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "status">
  >;
  readonly attempts: ReadonlyArray<
    Pick<OrchestrationV2RunAttempt, "id" | "runId" | "promptedNotificationIds">
  >;
}): ReadonlyArray<RecordedNotification> {
  const recorded = input.items.filter(
    (item): item is RecordedNotification => item.type === "notification" && item.runId === null,
  );
  if (recorded.length === 0) return [];
  const completedAttemptIds = new Set(
    input.providerTurns
      .filter((turn) => turn.status === "completed")
      .map((turn) => turn.runAttemptId),
  );
  const rolledBackRunIds = new Set(
    input.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const delivered = new Set(
    input.attempts
      .filter(
        (attempt) => completedAttemptIds.has(attempt.id) && !rolledBackRunIds.has(attempt.runId),
      )
      .flatMap((attempt) => attempt.promptedNotificationIds ?? []),
  );
  return recorded.filter((item) => !delivered.has(item.id));
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
