import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import {
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import {
  OrchestratorCommandRejectedError,
  OrchestratorDispatchError,
} from "../../../../apps/server/src/orchestration-v2/Orchestrator.ts";
import { ServerActivation } from "../../../../apps/server/src/serverActivation.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import {
  SOURCE_CHAIN_MAX_WAIT_MS,
  SOURCE_MAX_WAIT_MS,
  SOURCE_SETTLE_MS,
  SOURCE_WAKE_MAX_ATTEMPTS,
  reportsWithoutWake,
  sourceRunsCard,
  sourceWakeMessage,
  TaskSourceWake,
  TaskSourceWakeLive,
  wakesSourceChat,
  type PendingWakeRow,
} from "./TaskSourceWake.ts";

const row = (overrides: Partial<PendingWakeRow>): PendingWakeRow => ({
  runId: "run-1",
  status: "completed",
  runThreadId: "thread-run-1",
  agentName: "Developer",
  taskId: "task-1",
  taskTitle: "Fix the build",
  taskStatus: "Needs Review",
  sourceThreadId: "thread-chat",
  sourceIsRunThread: 0,
  taskArchived: 0,
  summary: "Fixed it.",
  ...overrides,
});

describe("TaskSourceWake", () => {
  it("wakes the source chat only for runs the agent finished", () => {
    expect(wakesSourceChat(row({ status: "completed" }))).toBe(true);
    expect(wakesSourceChat(row({ status: "blocked" }))).toBe(true);
    expect(wakesSourceChat(row({ status: "failed" }))).toBe(true);
    expect(wakesSourceChat(row({ status: "interrupted" }))).toBe(true);
    // A person stopped it, or the task closed under it.
    expect(wakesSourceChat(row({ status: "stopped" }))).toBe(false);
    expect(wakesSourceChat(row({ sourceThreadId: null }))).toBe(false);
    expect(wakesSourceChat(row({ taskId: null }))).toBe(false);
    // Tasks created by another run do not wake that run's thread.
    expect(wakesSourceChat(row({ sourceIsRunThread: 1 }))).toBe(false);
    expect(wakesSourceChat(row({ sourceThreadId: "thread-run-1" }))).toBe(false);
    // The task was archived after the run.
    expect(wakesSourceChat(row({ taskArchived: 1 }))).toBe(false);
  });

  it("reports one run with its thread and summary", () => {
    const run = row({});
    if (!wakesSourceChat(run)) throw new Error("expected a wake");
    const message = sourceWakeMessage([run], true);
    expect(message.notification).toEqual({
      source: {
        kind: "task_agent_run",
        tasks: [{ id: "task-1", title: "Fix the build", status: "Needs Review" }],
        childThreadId: "thread-run-1",
      },
      outcome: "completed",
      summary: 'Task "Fix the build" completed',
    });
    expect(message.text).toContain(
      '- Task "Fix the build" (task-1), run run-1 by agent "Developer": completed, task now Needs Review. Summary: Fixed it.',
    );
    expect(message.text).toContain("No run for this chat's tasks is in progress now.");
  });

  it("batches runs that finished together into one message", () => {
    const runs = [
      row({}),
      row({
        runId: "run-2",
        runThreadId: "thread-run-2",
        taskId: "task-2",
        taskTitle: "Docs",
        status: "failed",
        summary: null,
      }),
    ].filter(wakesSourceChat);
    const [first, ...rest] = runs;
    if (first === undefined) throw new Error("expected wakes");
    const message = sourceWakeMessage([first, ...rest], false);
    expect(message.notification.outcome).toBe("failed");
    expect(message.notification.summary).toBe("2 task runs finished: Fix the build, Docs");
    expect(message.notification.source).toEqual({
      kind: "task_agent_run",
      tasks: [
        { id: "task-1", title: "Fix the build", status: "Needs Review" },
        { id: "task-2", title: "Docs", status: "Needs Review" },
      ],
    });
    // Other work still runs: no idle line.
    expect(message.text.split("\n")).toHaveLength(4);
  });

  it("reports runs that all completed as a card, with each task once", () => {
    const runs = [
      row({}),
      row({ runId: "run-2", runThreadId: "thread-run-2", agentName: "Reviewer" }),
      row({
        runId: "run-3",
        runThreadId: "thread-run-3",
        taskId: "task-2",
        taskTitle: "Docs",
        taskStatus: "Done",
        summary: null,
      }),
    ].filter(wakesSourceChat);
    const [first, ...rest] = runs;
    if (first === undefined) throw new Error("expected runs");
    // Only with waking on completion turned off.
    expect(reportsWithoutWake(runs, false)).toBe(true);
    expect(reportsWithoutWake(runs, true)).toBe(false);
    for (const wakeOnCompletion of [true, false]) {
      expect(reportsWithoutWake([...runs, { ...first, status: "blocked" }], wakeOnCompletion)).toBe(
        false,
      );
      expect(reportsWithoutWake([{ ...first, status: "failed" }], wakeOnCompletion)).toBe(false);
      expect(reportsWithoutWake([{ ...first, status: "interrupted" }], wakeOnCompletion)).toBe(
        false,
      );
    }
    const card = sourceRunsCard([first, ...rest]);
    expect(card.source).toEqual({
      kind: "task_agent_run",
      tasks: [
        { id: "task-1", title: "Fix the build", status: "Needs Review" },
        { id: "task-2", title: "Docs", status: "Done" },
      ],
    });
    expect(card.outcome).toBe("completed");
    expect(card.summary).toBe("2 tasks done: Fix the build, Docs");
    expect(card.detail?.split("\n")).toEqual([
      "Task-agent runs finished for tasks created in this chat:",
      '- Task "Fix the build" (task-1), run run-1 by agent "Developer": completed, task now Needs Review. Summary: Fixed it.',
      '- Task "Fix the build" (task-1), run run-2 by agent "Reviewer": completed, task now Needs Review. Summary: Fixed it.',
      '- Task "Docs" (task-2), run run-3 by agent "Developer": completed, task now Done.',
      "Read a task with task_get when you need its full output.",
    ]);
    expect(sourceRunsCard([first]).summary).toBe('Task "Fix the build" done');
  });
});

const at = "2026-10-06T10:00:00.000Z";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

/**
 * The v2 dispatch a wake goes through, with v2's command receipts: a command id
 * it already ran is answered from the receipt without delivering anything.
 * `fail` decides per source chat whether a new command fails, and how.
 */
function fakeDispatch(fail: (threadId: string) => "transient" | "permanent" | null) {
  const handled = new Set<string>();
  /** A wake starts a model turn; a card is only recorded. Its text is the card's detail. */
  const delivered: Array<{
    readonly threadId: string;
    readonly kind: "wake" | "card";
    readonly text: string;
  }> = [];
  const attempts: string[] = [];
  const service = {
    dispatch: (command: OrchestrationV2ServerCommand) =>
      Effect.gen(function* () {
        if (command.type !== "message.dispatch" && command.type !== "thread.notification.record") {
          return yield* Effect.die("unexpected command");
        }
        attempts.push(command.threadId);
        if (handled.has(command.commandId)) return { sequence: 0 };
        const failure = fail(command.threadId);
        if (failure === "permanent") {
          return yield* new OrchestratorCommandRejectedError({
            commandId: command.commandId,
            commandType: command.type,
          });
        }
        if (failure === "transient") {
          return yield* new OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: command.type,
          });
        }
        handled.add(command.commandId);
        delivered.push(
          command.type === "message.dispatch"
            ? { threadId: command.threadId, kind: "wake", text: command.text }
            : {
                threadId: command.threadId,
                kind: "card",
                text: command.notification.detail ?? "",
              },
        );
        return { sequence: delivered.length };
      }),
  };
  return { service, delivered, attempts };
}

const withWake = <A, E>(
  dispatch: ReturnType<typeof fakeDispatch>,
  body: Effect.Effect<A, E, TaskRepository | TaskSourceWake | SqlClient.SqlClient>,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) =>
  // Runs below end at `at`; by the first sweep their chats have settled.
  Effect.andThen(TestClock.setTime(Date.parse(at) + 60_000), body).pipe(
    Effect.provide(
      Layer.mergeAll(TaskSourceWakeLive, TaskRepositoryLive).pipe(
        Layer.provideMerge(
          Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
        ),
        Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
        Layer.provide(Layer.succeed(ThreadManagementService, dispatch.service as never)),
        Layer.provide(ServerSettings.layerTest(settings).pipe(Layer.orDie)),
        // The background sweep stays parked; the tests sweep by hand.
        Layer.provide(Layer.succeed(ServerActivation, Effect.never)),
      ),
    ),
  );

/** A run of a task created in `sourceThreadId`, finished at `at` unless still running. */
const finishedRun = (
  id: string,
  sourceThreadId: string,
  status: "completed" | "failed" | "running" = "completed",
  startedAt = at,
) =>
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* repository.upsertAgent({
      id: TaskAgentId.make("agent"),
      projectId: null,
      name: "Developer",
      enabled: false,
      startStatuses: [],
      startTags: [],
      startRunStatuses: [],
      config: { role: "Developer", modelSelection, instructions: "Work." },
      createdAt: at,
      updatedAt: at,
    });
    yield* repository.upsert({
      id: TaskId.make(`task-${id}`),
      projectId: ProjectId.make("project"),
      title: `Task ${id}`,
      description: "",
      output: null,
      status: "Needs Review",
      priority: null,
      createdBy: "agent",
      assigneeAgentRunId: null,
      sourceThreadId: ThreadId.make(sourceThreadId),
      sourceRunId: null,
      metadata: null,
      tags: [],
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
    });
    yield* repository.createAgentRun({
      id: TaskAgentRunId.make(id),
      taskId: TaskId.make(`task-${id}`),
      agentId: TaskAgentId.make("agent"),
      threadId: ThreadId.make(`thread-${id}`),
      modelSelection,
      status,
      startedAt,
      completedAt: status === "running" ? null : at,
      triggerRunId: null,
      continuesRunId: null,
    });
  });

const wakeState = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const runs = yield* sql<{ readonly id: string; readonly told: number }>`
    SELECT id, source_wake_at IS NOT NULL AS told FROM task_agent_runs ORDER BY id
  `;
  const batches = yield* sql<{ readonly id: string; readonly attempts: number }>`
    SELECT id, attempts FROM task_source_wake_batches ORDER BY id
  `;
  return {
    told: runs.filter((run) => run.told === 1).map((run) => run.id),
    batches: batches.map((batch) => `${batch.id}:${batch.attempts}`),
  };
});

/** Ends a running run now. */
const finishNow = (id: string, status: "completed" | "failed" = "completed") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const completedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      UPDATE task_agent_runs SET status = ${status}, completed_at = ${completedAt}
      WHERE id = ${id}
    `;
  });

/** Starts a run now. */
const startNow = (id: string, sourceThreadId: string) =>
  Effect.flatMap(DateTime.now, (now) =>
    finishedRun(id, sourceThreadId, "running", DateTime.formatIso(now)),
  );

/**
 * A queue hand-off: the next run starts, then the previous one records its end,
 * as a task agent's last two task updates do.
 */
const handOff = (previous: string, next: string, sourceThreadId: string) =>
  Effect.gen(function* () {
    yield* startNow(next, sourceThreadId);
    yield* TestClock.adjust(30_000);
    yield* finishNow(previous);
  });

const reportedRuns = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("- Task "))
    .map((line) => /run (\S+)/.exec(line)?.[1]);

/** Makes every waiting batch due now, as if its retry time passed. */
const retryNow = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE task_source_wake_batches SET retry_at = NULL`;
});

const WAKE_OFF = { wakeChatOnTaskCompletion: false };

describe("TaskSourceWake settling", () => {
  it.effect("by default a chat's model wakes once for completed runs after they settle", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const wake = yield* TaskSourceWake;
        yield* finishedRun("r1", "chat");
        yield* finishedRun("r2", "chat", "running");
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 0);

        yield* finishNow("r2");
        yield* TestClock.adjust(SOURCE_SETTLE_MS);
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 1);
        const [message] = dispatch.delivered;
        // One model wake for the batch, no card beside it.
        assert.strictEqual(message!.kind, "wake");
        assert.strictEqual(message!.threadId, "chat");
        assert.include(message!.text, "run r1");
        assert.include(message!.text, "run r2");
        assert.include(message!.text, "No run for this chat's tasks is in progress now.");
        assert.deepStrictEqual(yield* wakeState, { told: ["r1", "r2"], batches: [] });
      }),
    );
  });

  it.effect("with waking off a chat sees completed runs as one card once they settle", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const wake = yield* TaskSourceWake;
        yield* finishedRun("r1", "chat");
        yield* finishedRun("r2", "chat", "running");
        yield* finishedRun("r-other", "other-chat");
        // The chat's second task still runs; another chat is not held up by it.
        yield* wake.sweep;
        assert.deepStrictEqual(
          dispatch.delivered.map((message) => message.threadId),
          ["other-chat"],
        );
        assert.deepStrictEqual(yield* wakeState, { told: ["r-other"], batches: [] });

        // Its last run just ended: a run it triggers may still start.
        yield* finishNow("r2");
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 1);

        yield* TestClock.adjust(SOURCE_SETTLE_MS);
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 2);
        const message = dispatch.delivered[1]!;
        assert.strictEqual(message.threadId, "chat");
        // Recorded in the chat; its model is not woken for it.
        assert.deepStrictEqual(
          dispatch.delivered.map((report) => report.kind),
          ["card", "card"],
        );
        assert.include(message.text, "run r1");
        assert.include(message.text, "run r2");
        assert.deepStrictEqual(yield* wakeState, {
          told: ["r-other", "r1", "r2"],
          batches: [],
        });
      }),
      WAKE_OFF,
    );
  });

  it.effect.each([
    ["on", {}],
    ["off", WAKE_OFF],
  ] as const)(
    "a failed run wakes its chat at once, with the completed runs waiting (waking %s)",
    ([, settings]) => {
      const dispatch = fakeDispatch(() => null);
      return withWake(
        dispatch,
        Effect.gen(function* () {
          const wake = yield* TaskSourceWake;
          yield* finishedRun("r1", "chat");
          yield* finishedRun("r2", "chat", "running");
          yield* finishedRun("r3", "chat", "failed");
          yield* wake.sweep;
          assert.lengthOf(dispatch.delivered, 1);
          const [message] = dispatch.delivered;
          // The completed run goes with the failure into one model wake.
          assert.strictEqual(message!.kind, "wake");
          assert.include(message!.text, "run r1");
          assert.include(message!.text, "run r3");
          assert.include(message!.text, ": failed");
          // The failure that released the batch comes first.
          assert.isBelow(message!.text.indexOf("run r3"), message!.text.indexOf("run r1"));
          assert.notInclude(message!.text, "No run for this chat's tasks is in progress now.");
          assert.deepStrictEqual(yield* wakeState, { told: ["r1", "r3"], batches: [] });
        }),
        settings,
      );
    },
  );

  it.effect(
    "a completed run behind work that never settles goes out after the longest wait",
    () => {
      const dispatch = fakeDispatch(() => null);
      return withWake(
        dispatch,
        Effect.gen(function* () {
          const wake = yield* TaskSourceWake;
          const minutesBefore = (minutes: number) =>
            new Date(Date.parse(at) - minutes * 60_000).toISOString();
          yield* finishedRun("r1", "chat", "completed", minutesBefore(10));
          // Started while r1 ran, but long before it ended: not its successor.
          yield* finishedRun("r2", "chat", "running", minutesBefore(5));
          yield* wake.sweep;
          assert.lengthOf(dispatch.delivered, 0);

          yield* TestClock.setTime(Date.parse(at) + SOURCE_MAX_WAIT_MS);
          yield* wake.sweep;
          yield* wake.sweep;
          assert.lengthOf(dispatch.delivered, 1);
          const [message] = dispatch.delivered;
          assert.strictEqual(message!.kind, "wake");
          assert.include(message!.text, "run r1");
          assert.notInclude(message!.text, "run r2");
          // r2 still runs: the report does not say the chat's work is done.
          assert.notInclude(message!.text, "No run for this chat's tasks is in progress now.");
          assert.deepStrictEqual(yield* wakeState, { told: ["r1"], batches: [] });
        }),
      );
    },
  );

  it.effect("a chain of queued runs reports once, after its last run settles", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const wake = yield* TaskSourceWake;
        yield* startNow("r1", "chat");
        for (const [previous, next] of [
          ["r1", "r2"],
          ["r2", "r3"],
        ] as const) {
          yield* TestClock.adjust(2 * SOURCE_MAX_WAIT_MS);
          yield* handOff(previous, next, "chat");
          yield* TestClock.adjust(2 * SOURCE_MAX_WAIT_MS);
          yield* wake.sweep;
          assert.lengthOf(dispatch.delivered, 0);
        }

        yield* TestClock.adjust(2 * SOURCE_MAX_WAIT_MS);
        yield* finishNow("r3");
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 0);
        yield* TestClock.adjust(SOURCE_SETTLE_MS);
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 1);
        const [message] = dispatch.delivered;
        assert.deepStrictEqual(reportedRuns(message!.text), ["r1", "r2", "r3"]);
        assert.include(message!.text, "No run for this chat's tasks is in progress now.");
        assert.deepStrictEqual(yield* wakeState, { told: ["r1", "r2", "r3"], batches: [] });
      }),
    );
  });

  it.effect("a failed step in a chain wakes at once, with the completed steps before it", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const wake = yield* TaskSourceWake;
        yield* startNow("r1", "chat");
        yield* TestClock.adjust(SOURCE_MAX_WAIT_MS);
        yield* handOff("r1", "r2", "chat");
        yield* TestClock.adjust(2 * SOURCE_MAX_WAIT_MS);
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 0);

        yield* finishNow("r2", "failed");
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 1);
        const [message] = dispatch.delivered;
        assert.strictEqual(message!.kind, "wake");
        assert.deepStrictEqual(reportedRuns(message!.text), ["r2", "r1"]);
        assert.deepStrictEqual(yield* wakeState, { told: ["r1", "r2"], batches: [] });
      }),
    );
  });

  it.effect("a chain that never ends still reports after the longest chain wait", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const wake = yield* TaskSourceWake;
        const step = 60 * 60_000;
        const steps = SOURCE_CHAIN_MAX_WAIT_MS / step;
        yield* startNow("r0", "chat");
        for (let index = 1; index <= steps; index += 1) {
          yield* TestClock.adjust(step);
          yield* handOff(`r${index - 1}`, `r${index}`, "chat");
          yield* wake.sweep;
          assert.lengthOf(dispatch.delivered, 0);
        }

        // r0 ended SOURCE_CHAIN_MAX_WAIT_MS ago and the chain still runs.
        yield* TestClock.adjust(step);
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 1);
        const [message] = dispatch.delivered;
        assert.deepStrictEqual(
          reportedRuns(message!.text),
          Array.from({ length: steps }, (_, index) => `r${index}`),
        );
        assert.notInclude(message!.text, "No run for this chat's tasks is in progress now.");
      }),
    );
  });

  it.effect("an urgent batch split by the sweep window sends the failure first, not idle", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const wake = yield* TaskSourceWake;
        for (let index = 0; index < 200; index += 1) {
          yield* finishedRun(`r${String(index).padStart(3, "0")}`, "chat");
        }
        yield* finishedRun("r-failed", "chat", "failed");
        // Newer than every completed run, so it would not fit a window in end order.
        const failedAt = new Date(Date.parse(at) + 1_000).toISOString();
        yield* sql`UPDATE task_agent_runs SET completed_at = ${failedAt} WHERE id = 'r-failed'`;
        yield* finishedRun("r-active", "chat", "running");
        yield* wake.sweep;
        assert.isAtLeast(dispatch.delivered.length, 1);
        const [first] = dispatch.delivered;
        assert.strictEqual(first!.kind, "wake");
        const lines = first!.text.split("\n");
        assert.include(lines[1], "run r-failed");
        const reported = () =>
          dispatch.delivered.flatMap((message) =>
            message.text.split("\n").filter((line) => line.startsWith("- Task ")),
          );
        // The completed run left out of the window waits while r-active runs.
        yield* wake.sweep;
        assert.lengthOf(reported(), 200);
        yield* TestClock.setTime(Date.parse(at) + SOURCE_MAX_WAIT_MS);
        yield* wake.sweep;
        assert.lengthOf(reported(), 201);
        for (const message of dispatch.delivered) {
          assert.notInclude(message.text, "No run for this chat's tasks is in progress now.");
        }
      }),
    );
  });
});

describe("TaskSourceWake batches", () => {
  it.effect("a retried batch sends the same runs and acknowledges only them", () => {
    const dispatch = fakeDispatch(() => null);
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const wake = yield* TaskSourceWake;
        yield* finishedRun("r1", "chat");
        // The message goes out, then recording it fails.
        yield* sql`CREATE TABLE fail_marking (armed INTEGER)`;
        yield* sql`INSERT INTO fail_marking VALUES (1)`;
        yield* sql`
          CREATE TRIGGER fail_marking BEFORE UPDATE OF source_wake_at ON task_agent_runs
          WHEN EXISTS (SELECT 1 FROM fail_marking)
          BEGIN SELECT RAISE(ABORT, 'marking failed'); END
        `;
        yield* wake.sweep;
        assert.lengthOf(dispatch.delivered, 1);
        assert.deepStrictEqual((yield* wakeState).told, []);

        // Another run finishes before the retry.
        yield* sql`DELETE FROM fail_marking`;
        yield* finishedRun("r2", "chat");
        yield* wake.sweep;
        assert.deepStrictEqual(
          dispatch.delivered.map((message) => [
            message.text.includes("run r1"),
            message.text.includes("run r2"),
          ]),
          [
            [true, false],
            [false, true],
          ],
        );
        assert.deepStrictEqual(yield* wakeState, { told: ["r1", "r2"], batches: [] });
      }),
    );
  });

  it.effect("an archived task's finished runs wake no chat, also from a waiting batch", () => {
    let healthy = false;
    const dispatch = fakeDispatch(() => (healthy ? null : "transient"));
    const archive = (id: string) =>
      Effect.gen(function* () {
        yield* (yield* TaskRepository).setArchived({
          ids: [TaskId.make(`task-${id}`)],
          archived: true,
          actor: { type: "person" },
        });
      });
    return withWake(
      dispatch,
      Effect.gen(function* () {
        const wake = yield* TaskSourceWake;
        // Archived after the run finished, before the sweep.
        yield* finishedRun("r-archived", "chat");
        yield* archive("r-archived");
        yield* wake.sweep;
        assert.deepStrictEqual(dispatch.attempts, []);
        assert.deepStrictEqual(yield* wakeState, { told: ["r-archived"], batches: [] });

        // Archived while its batch waits for a retry.
        yield* finishedRun("r-waiting", "busy-chat");
        yield* wake.sweep;
        assert.deepStrictEqual(yield* wakeState, {
          told: ["r-archived"],
          batches: ["r-waiting:1"],
        });
        yield* archive("r-waiting");
        healthy = true;
        yield* retryNow;
        yield* wake.sweep;
        assert.deepStrictEqual(dispatch.delivered, []);
        assert.deepStrictEqual(yield* wakeState, {
          told: ["r-archived", "r-waiting"],
          batches: [],
        });
      }),
    );
  });

  it.effect(
    "transient failures are retried up to a cap; permanent ones are handled at once",
    () => {
      let healthy = false;
      const dispatch = fakeDispatch((threadId) =>
        threadId === "deleted-chat"
          ? "permanent"
          : threadId === "broken-chat" || !healthy
            ? "transient"
            : null,
      );
      return withWake(
        dispatch,
        Effect.gen(function* () {
          const wake = yield* TaskSourceWake;
          yield* finishedRun("r-busy", "busy-chat");
          yield* finishedRun("r-deleted", "deleted-chat");
          yield* finishedRun("r-broken", "broken-chat");
          yield* wake.sweep;
          assert.deepStrictEqual(yield* wakeState, {
            told: ["r-deleted"],
            batches: ["r-broken:1", "r-busy:1"],
          });

          // Not due yet: nothing is sent again.
          yield* wake.sweep;
          assert.lengthOf(dispatch.attempts, 3);

          // The busy chat recovers on its retry.
          healthy = true;
          yield* retryNow;
          yield* wake.sweep;
          assert.lengthOf(dispatch.delivered, 1);
          assert.deepStrictEqual(yield* wakeState, {
            told: ["r-busy", "r-deleted"],
            batches: ["r-broken:2"],
          });

          // A chat that keeps failing is given up on after the cap.
          for (let attempt = 3; attempt <= SOURCE_WAKE_MAX_ATTEMPTS; attempt += 1) {
            yield* retryNow;
            yield* wake.sweep;
          }
          assert.strictEqual(
            dispatch.attempts.filter((threadId) => threadId === "broken-chat").length,
            SOURCE_WAKE_MAX_ATTEMPTS,
          );
          assert.deepStrictEqual(yield* wakeState, {
            told: ["r-broken", "r-busy", "r-deleted"],
            batches: [],
          });
        }),
      );
    },
  );
});
