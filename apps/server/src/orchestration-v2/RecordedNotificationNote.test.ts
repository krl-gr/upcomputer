import { assert, it } from "@effect/vitest";
import {
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  pendingRecordedNotifications,
  recordedNotificationsNote,
} from "./RecordedNotificationNote.ts";

const minute = (value: number) =>
  DateTime.makeUnsafe(`2026-10-11T10:${String(value).padStart(2, "0")}:00.000Z`);

function run(ordinal: number, extra: Partial<OrchestrationV2Run> = {}) {
  return {
    id: RunId.make(`run:${ordinal}`),
    ordinal,
    activeAttemptId: RunAttemptId.make(`attempt:${ordinal}`),
    status: "completed",
    ...extra,
  } as OrchestrationV2Run;
}

function notice(at: number, extra: Partial<OrchestrationV2TurnItem> = {}) {
  return {
    id: TurnItemId.make(`turn-item:notification:${at}`),
    threadId: ThreadId.make("thread:chat"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: at,
    status: "completed",
    title: null,
    startedAt: minute(at),
    completedAt: minute(at),
    updatedAt: minute(at),
    type: "notification",
    source: { kind: "task_agent_run", tasks: [] },
    outcome: "completed",
    summary: `Notice ${at}`,
    ...extra,
  } as OrchestrationV2TurnItem;
}

/** One attempt per run, with the notices its prompt carried and its provider turn status. */
const pending = (input: {
  readonly runs: ReadonlyArray<{
    readonly run: OrchestrationV2Run;
    readonly prompted?: ReadonlyArray<number>;
    readonly turn?: "completed" | "failed" | "interrupted";
  }>;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
}) =>
  pendingRecordedNotifications({
    items: input.items,
    runs: input.runs.map((entry) => entry.run),
    providerTurns: input.runs.flatMap((entry) =>
      entry.turn === undefined
        ? []
        : [{ runAttemptId: entry.run.activeAttemptId!, status: entry.turn }],
    ),
    attempts: input.runs.map((entry) => ({
      id: entry.run.activeAttemptId!,
      runId: entry.run.id,
      ...(entry.prompted === undefined
        ? {}
        : {
            promptedNotificationIds: entry.prompted.map((at) =>
              TurnItemId.make(`turn-item:notification:${at}`),
            ),
          }),
    })),
  }).map((item) => (item.type === "notification" ? item.summary : item.type));

it("carries notifications until a completed turn's prompt carried them", () => {
  const items = [notice(0), notice(5), notice(8)];
  assert.deepEqual(pending({ runs: [], items }), ["Notice 0", "Notice 5", "Notice 8"]);
  // Run 1's prompt carried 0 and 5; 8 was recorded after it was read.
  assert.deepEqual(
    pending({ runs: [{ run: run(1), prompted: [0, 5], turn: "completed" }], items }),
    ["Notice 8"],
  );
});

it("does not count a prompt whose turn did not complete, or a rolled-back run", () => {
  const items = [notice(2)];
  assert.deepEqual(pending({ runs: [{ run: run(1), prompted: [2], turn: "failed" }], items }), [
    "Notice 2",
  ]);
  assert.deepEqual(pending({ runs: [{ run: run(1), prompted: [2] }], items }), ["Notice 2"]);
  assert.deepEqual(
    pending({
      runs: [{ run: run(1, { status: "rolled_back" }), prompted: [2], turn: "completed" }],
      items,
    }),
    ["Notice 2"],
  );
});

it("does not infer delivery from a later run's start time", () => {
  // Recorded while run 1 started: its prompt did not carry it, though run 1 started later.
  const items = [notice(5)];
  assert.deepEqual(
    pending({
      runs: [{ run: run(1, { startedAt: minute(6) }), turn: "completed" }],
      items,
    }),
    ["Notice 5"],
  );
});

it("ignores notifications of runs and other turn items", () => {
  const items = [
    notice(2),
    // A wake's notification belongs to its own run, whose prompt is its text.
    notice(3, { runId: RunId.make("run:1") }),
    { ...notice(4), type: "system_notice", message: "Other" } as OrchestrationV2TurnItem,
  ];
  assert.deepEqual(pending({ runs: [], items }), ["Notice 2"]);
});

it("writes a bounded note with each notification's detail", () => {
  const note = recordedNotificationsNote([
    notice(1, {
      summary: "2 tasks done: A, B",
      detail: "- Task A: completed.\n- Task B: completed.",
    }),
    notice(2, { summary: "Task C done" }),
  ] as never);
  assert.strictEqual(
    note,
    [
      "Note: these notifications were shown in this thread since your last turn. You were not asked to act on them then:",
      "- 2 tasks done: A, B",
      "  - Task A: completed.",
      "  - Task B: completed.",
      "- Task C done",
    ].join("\n"),
  );
  assert.strictEqual(recordedNotificationsNote([]), "");
  const many = recordedNotificationsNote(
    Array.from({ length: 12 }, (_, index) => notice(index)) as never,
  );
  assert.include(many, "- 2 earlier notifications omitted");
  assert.include(many, "- Notice 11");
  assert.notInclude(many, "- Notice 1\n");
});
