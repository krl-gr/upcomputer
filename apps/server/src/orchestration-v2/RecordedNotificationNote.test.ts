import { assert, it } from "@effect/vitest";
import {
  MessageId,
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

function run(ordinal: number, startedAt: number, extra: Partial<OrchestrationV2Run> = {}) {
  return {
    id: RunId.make(`run:${ordinal}`),
    ordinal,
    userMessageId: MessageId.make(`message:${ordinal}`),
    activeAttemptId: RunAttemptId.make(`attempt:${ordinal}`),
    status: "completed",
    startedAt: minute(startedAt),
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

const pending = (input: {
  readonly target: OrchestrationV2Run;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly compactions?: ReadonlyArray<string>;
}) =>
  pendingRecordedNotifications({
    items: input.items,
    runs: input.runs,
    // Every run except the target completed a provider turn.
    providerTurns: input.runs
      .filter((source) => source.id !== input.target.id)
      .map((source) => ({ runAttemptId: source.activeAttemptId!, status: "completed" as const })),
    attempts: input.runs.map((source) => ({ id: source.activeAttemptId!, runId: source.id })),
    compactionMessageIds: new Set(input.compactions ?? []),
    run: input.target,
  }).map((item) => (item.type === "notification" ? item.summary : item.type));

it("carries notifications recorded since the last prompted run, once", () => {
  const first = run(1, 1);
  const second = run(2, 10);
  const third = run(3, 20);
  // Recorded before run 1, while run 1 ran, and after it.
  const items = [notice(0), notice(5), notice(8)];
  assert.deepEqual(pending({ target: first, runs: [first], items }), [
    "Notice 0",
    "Notice 5",
    "Notice 8",
  ]);
  assert.deepEqual(pending({ target: second, runs: [first, second], items }), [
    "Notice 5",
    "Notice 8",
  ]);
  // Run 2's completed turn delivered them.
  assert.deepEqual(pending({ target: third, runs: [first, second, third], items }), []);
});

it("ignores notifications of runs, and turns that did not prompt", () => {
  const first = run(1, 1);
  const items = [
    notice(2),
    // A wake's notification belongs to its own run, whose prompt is its text.
    notice(3, { runId: RunId.make("run:1") }),
    { ...notice(4), type: "system_notice", message: "Other" } as OrchestrationV2TurnItem,
  ];
  // Run 1 never completed a provider turn, so it delivered nothing.
  const second = run(2, 10);
  assert.deepEqual(
    pendingRecordedNotifications({
      items,
      runs: [first, second],
      providerTurns: [{ runAttemptId: first.activeAttemptId!, status: "failed" }],
      attempts: [{ id: first.activeAttemptId!, runId: first.id }],
      compactionMessageIds: new Set(),
      run: second,
    }).map((item) => item.id),
    [TurnItemId.make("turn-item:notification:2")],
  );
});

it("leaves compactions and restart continuations without the note", () => {
  const first = run(1, 1);
  const compaction = run(2, 10);
  const continuation = run(3, 20, { restartContinuationOfRunId: RunId.make("run:1") });
  const next = run(4, 30);
  const items = [notice(5)];
  const compactions = ["message:2"];
  assert.deepEqual(
    pending({ target: compaction, runs: [first, compaction], items, compactions }),
    [],
  );
  assert.deepEqual(
    pending({ target: continuation, runs: [first, compaction, continuation], items, compactions }),
    [],
  );
  // Neither of them told the agent, so the next prompted turn still does.
  assert.deepEqual(
    pending({ target: next, runs: [first, compaction, continuation, next], items, compactions }),
    ["Notice 5"],
  );
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
