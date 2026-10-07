import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import {
  OrchestratorCommandRejectedError,
  OrchestratorDispatchError,
} from "../../../../apps/server/src/orchestration-v2/Orchestrator.ts";
import { ServerActivation } from "../../../../apps/server/src/serverActivation.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import {
  SOURCE_WAKE_MAX_ATTEMPTS,
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
    const message = sourceWakeMessage([run]);
    expect(message.notification).toEqual({
      source: {
        kind: "task_agent_run",
        tasks: [{ id: "task-1", title: "Fix the build" }],
        childThreadId: "thread-run-1",
      },
      outcome: "completed",
      summary: 'Task "Fix the build" completed',
    });
    expect(message.text).toContain(
      '- Task "Fix the build" (task-1), run run-1 by agent "Developer": completed. Summary: Fixed it.',
    );
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
    const message = sourceWakeMessage([first, ...rest]);
    expect(message.notification.outcome).toBe("failed");
    expect(message.notification.summary).toBe("2 task runs finished: Fix the build, Docs");
    expect(message.notification.source).toEqual({
      kind: "task_agent_run",
      tasks: [
        { id: "task-1", title: "Fix the build" },
        { id: "task-2", title: "Docs" },
      ],
    });
    expect(message.text.split("\n")).toHaveLength(4);
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
  const delivered: Array<{ readonly threadId: string; readonly text: string }> = [];
  const attempts: string[] = [];
  const service = {
    dispatch: (command: OrchestrationV2ServerCommand) =>
      Effect.gen(function* () {
        if (command.type !== "message.dispatch") return yield* Effect.die("unexpected command");
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
        delivered.push({ threadId: command.threadId, text: command.text });
        return { sequence: delivered.length };
      }),
  };
  return { service, delivered, attempts };
}

const withWake = <A, E>(
  dispatch: ReturnType<typeof fakeDispatch>,
  body: Effect.Effect<A, E, TaskRepository | TaskSourceWake | SqlClient.SqlClient>,
) =>
  body.pipe(
    Effect.provide(
      Layer.mergeAll(TaskSourceWakeLive, TaskRepositoryLive).pipe(
        Layer.provideMerge(
          Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
        ),
        Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
        Layer.provide(Layer.succeed(ThreadManagementService, dispatch.service as never)),
        // The background sweep stays parked; the tests sweep by hand.
        Layer.provide(Layer.succeed(ServerActivation, Effect.never)),
      ),
    ),
  );

/** A finished run of a task created in `sourceThreadId`. */
const finishedRun = (id: string, sourceThreadId: string) =>
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
      status: "completed",
      startedAt: at,
      completedAt: at,
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

/** Makes every waiting batch due now, as if its retry time passed. */
const retryNow = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE task_source_wake_batches SET retry_at = NULL`;
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
