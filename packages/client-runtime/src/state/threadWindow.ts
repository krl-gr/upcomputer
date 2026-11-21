import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { encodeThreadHistoryCursorBeforeRow } from "@t3tools/shared/threadHistoryCursor";

import type { ThreadHistoryMeta } from "./threadHistoryMerge.ts";

export interface ThreadWindowBudget {
  readonly maxRows: number;
  readonly maxBytes: number;
}

/**
 * An open thread keeps everything it streams. Past either limit, a settled run trims it back to
 * `keep`, so a thread followed for days stays bounded and trims rarely; older rows page back in.
 */
export const OPEN_THREAD_WINDOW = {
  trimAbove: { maxRows: 1_000, maxBytes: 2 * 1024 * 1024 },
  keep: { maxRows: 600, maxBytes: 1_200_000 },
} as const;

/** The tail the thread cache saves: small enough to write after every settled run. */
export const CACHED_THREAD_WINDOW: ThreadWindowBudget = { maxRows: 300, maxBytes: 1024 * 1024 };

const UNFINISHED_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export function isSettledRunStatus(status: OrchestrationV2Run["status"]): boolean {
  return !UNFINISHED_RUN_STATUSES.has(status);
}

/** About the JSON size of a value: string lengths plus a little per field. Cheap, no allocation. */
function estimateBytes(value: unknown, depth = 0): number {
  if (typeof value === "string") return value.length + 2;
  if (value === null || typeof value !== "object") return 8;
  if (depth > 4) return 16;
  let total = 2;
  if (Array.isArray(value)) {
    for (const entry of value) total += estimateBytes(entry, depth + 1) + 1;
    return total;
  }
  for (const key in value) {
    total += key.length + 4 + estimateBytes((value as Record<string, unknown>)[key], depth + 1);
  }
  return total;
}

// A kept window starts at a turn, as the server's own windows do: a user message that opens one
// or a notification.
function startsTurn(item: OrchestrationV2TurnItem): boolean {
  return (
    item.type === "notification" ||
    (item.type === "user_message" &&
      item.inputIntent !== "steer" &&
      item.inputIntent !== "promoted_queued_to_steer")
  );
}

export function exceedsThreadWindow(
  projection: OrchestrationV2ThreadProjection,
  budget: ThreadWindowBudget,
): boolean {
  const rows = projection.visibleTurnItems;
  if (rows.length > budget.maxRows) return true;
  let bytes = 0;
  for (const row of rows) {
    bytes += estimateBytes(row.item);
    if (bytes > budget.maxBytes) return true;
  }
  return false;
}

/**
 * Drops the oldest whole turns beyond `budget` and their messages, as a bounded snapshot leaves
 * them out, and points the history cursor at the first kept row so loading earlier activity
 * refills them. Null when the thread fits or cannot be cut.
 */
export function trimThreadWindow(
  projection: OrchestrationV2ThreadProjection,
  history: ThreadHistoryMeta,
  budget: ThreadWindowBudget,
): {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly history: ThreadHistoryMeta;
} | null {
  const rows = projection.visibleTurnItems;
  const threadId = projection.thread.id;
  // The newest rows that fit the budget; the first one kept is `fits`.
  let fits = rows.length;
  let bytes = 0;
  while (fits > 0 && rows.length - fits < budget.maxRows) {
    bytes += estimateBytes(rows[fits - 1]!.item);
    if (bytes > budget.maxBytes) break;
    fits -= 1;
  }
  if (fits === 0) return null;
  const isTurnStart = (row: OrchestrationV2ProjectedTurnItem) =>
    row.visibility === "local" && row.sourceThreadId === threadId && startsTurn(row.item);
  // Cut at the first turn inside the budget, else at the newest turn before it.
  let cut = rows.findIndex((row, index) => index >= fits && isTurnStart(row));
  if (cut === -1) cut = rows.findLastIndex((row, index) => index < fits && isTurnStart(row));
  if (cut <= 0) return null;

  const runs = new Map(projection.runs.map((run) => [run.id, run]));
  const finished = (runId: OrchestrationV2TurnItem["runId"]) => {
    if (runId === null) return true;
    const run = runs.get(runId);
    return run === undefined || !UNFINISHED_RUN_STATUSES.has(run.status);
  };
  for (let index = 0; index < cut; index += 1) {
    const row = rows[index]!;
    if (row.sourceThreadId === threadId && !finished(row.item.runId)) return null;
  }

  const cutRow = rows[cut]!;
  const cutOrdinal = cutRow.item.ordinal;
  const keptItems: OrchestrationV2TurnItem[] = [];
  const keptRunIds = new Set<string>();
  const droppedRunIds = new Set<string>();
  for (const item of projection.turnItems) {
    if (item.ordinal < cutOrdinal && finished(item.runId)) {
      if (item.runId !== null) droppedRunIds.add(item.runId);
      continue;
    }
    keptItems.push(item);
    if (item.runId !== null) keptRunIds.add(item.runId);
  }
  for (const runId of keptRunIds) droppedRunIds.delete(runId);

  // Runs, attempts, nodes, checkpoints and provider turns stay: history pages bring back only
  // rows, so these are kept as the server's bounded snapshot keeps them.
  return {
    projection: {
      ...projection,
      messages: projection.messages.filter(
        (message) =>
          message.runId === null ||
          !droppedRunIds.has(message.runId) ||
          message.delegatedCompletion !== undefined ||
          message.workflowScript === true,
      ),
      turnItems: keptItems,
      visibleTurnItems: rows
        .slice(cut)
        .map((row, position) => (row.position === position ? row : { ...row, position })),
    },
    history: {
      ...history,
      historyCursor: encodeThreadHistoryCursorBeforeRow({
        sourceThreadId: cutRow.sourceThreadId,
        sourceItemId: cutRow.sourceItemId,
        position: cutRow.position,
      }),
      hasMoreHistory: true,
      latestLocalTurnOrdinal:
        history.latestLocalTurnOrdinal ??
        keptItems.reduce((latest, item) => Math.max(latest, item.ordinal), cutOrdinal),
    },
  };
}
