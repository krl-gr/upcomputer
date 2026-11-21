import { describe, expect, it } from "vite-plus/test";

import { v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { EMPTY_THREAD_HISTORY_META } from "./threadHistoryMerge.ts";
import { exceedsThreadWindow, trimThreadWindow } from "./threadWindow.ts";
import { settledTurnsProjection } from "./threadWindowTestFixtures.ts";

const thread = (turns: number, options?: Parameters<typeof settledTurnsProjection>[2]) =>
  settledTurnsProjection(v2Projection, turns, options);

const decodeCursor = (cursor: string) =>
  JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, unknown>;

describe("trimThreadWindow", () => {
  it("keeps a thread that fits", () => {
    const projection = thread(5);
    expect(exceedsThreadWindow(projection, { maxRows: 10, maxBytes: 1_000_000 })).toBe(false);
    expect(
      trimThreadWindow(projection, EMPTY_THREAD_HISTORY_META, { maxRows: 10, maxBytes: 1_000_000 }),
    ).toBeNull();
  });

  it("drops whole old turns with their messages and points the cursor at the first kept row", () => {
    const projection = thread(10);
    expect(exceedsThreadWindow(projection, { maxRows: 7, maxBytes: 1_000_000 })).toBe(true);
    const trimmed = trimThreadWindow(projection, EMPTY_THREAD_HISTORY_META, {
      maxRows: 7,
      maxBytes: 1_000_000,
    });
    // Seven rows reach back into turn 7's command, so the window starts at turn 8.
    expect(trimmed?.projection.visibleTurnItems.map((row) => row.sourceItemId)).toEqual([
      "user-8",
      "command-8",
      "user-9",
      "command-9",
      "user-10",
      "command-10",
    ]);
    expect(trimmed?.projection.visibleTurnItems.map((row) => row.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(trimmed?.projection.turnItems.map((item) => item.id)).toEqual([
      "user-8",
      "command-8",
      "user-9",
      "command-9",
      "user-10",
      "command-10",
    ]);
    expect(trimmed?.projection.messages.map((message) => message.id)).toEqual([
      "message-run-8",
      "message-run-9",
      "message-run-10",
      "delegated-completion",
      "workflow-script",
    ]);
    // History pages bring back only rows, so every run keeps its records.
    for (const key of ["runs", "attempts", "nodes", "checkpoints", "providerTurns"] as const) {
      expect(trimmed?.projection[key]).toBe(projection[key]);
    }
    expect(trimmed?.history).toMatchObject({ hasMoreHistory: true, expanded: false });
    // The server ends the next page just before the row the cursor names.
    expect(decodeCursor(trimmed!.history.historyCursor!)).toEqual({
      v: 1,
      seq: 0,
      st: v2ThreadId,
      si: "user-8",
      p: 14,
    });
    // A partial window drops late updates of rows older than this watermark.
    expect(trimmed?.history.latestLocalTurnOrdinal).toBe(10_000_002);
  });

  it("measures large tool replies against the byte budget", () => {
    const projection = thread(6, { outputBytes: 100_000 });
    expect(exceedsThreadWindow(projection, { maxRows: 1_000, maxBytes: 250_000 })).toBe(true);
    const trimmed = trimThreadWindow(projection, EMPTY_THREAD_HISTORY_META, {
      maxRows: 1_000,
      maxBytes: 250_000,
    });
    expect(trimmed?.projection.turnItems.map((item) => item.runId)).toEqual([
      "run-5",
      "run-5",
      "run-6",
      "run-6",
    ]);
  });

  it("keeps everything while a run in the dropped range is unfinished", () => {
    const projection = thread(10, { running: 2 });
    expect(
      trimThreadWindow(projection, EMPTY_THREAD_HISTORY_META, { maxRows: 7, maxBytes: 1_000_000 }),
    ).toBeNull();
  });

  it("keeps a thread whose excess is one turn", () => {
    const projection = thread(1, { outputBytes: 500_000 });
    expect(
      trimThreadWindow(projection, EMPTY_THREAD_HISTORY_META, { maxRows: 1, maxBytes: 1_000 }),
    ).toBeNull();
  });
});
