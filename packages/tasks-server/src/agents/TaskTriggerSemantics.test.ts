/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, test } from "vite-plus/test";

import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
} from "@upcomputer/tasks-contracts/v1";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@upcomputer/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
  runExperimentalFeatureMigrations,
} from "../../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import {
  TaskPromptSettingsStore,
  type TaskPromptSettingsStoreShape,
} from "../persistence/TaskPromptSettingsStore.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import {
  TaskAgentService,
  TaskAgentServiceLive,
  type TaskAgentServiceShape,
} from "./TaskAgentService.ts";

const directories: string[] = [];
const project = ProjectId.make("project-1");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

/** `legacy` writes rows into a database migrated only up to the version before trigger semantics. */
async function database(legacy?: (db: NodeSqlite.DatabaseSync) => void) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-task-triggers-"));
  directories.push(directory);
  const path = NodePath.join(directory, "tasks.sqlite");
  const sql = NodeSqliteClient.layer({ filename: path });
  const migrate = (count: number) =>
    Effect.runPromise(
      runExperimentalFeatureMigrations([
        {
          ...TASK_MIGRATION_CONTRIBUTION,
          migrations: TASK_MIGRATION_CONTRIBUTION.migrations.slice(0, count),
        },
      ]).pipe(Effect.provide(NodeSqliteClient.layer({ filename: path }))),
    );
  if (legacy) {
    await migrate(11);
    const db = new NodeSqlite.DatabaseSync(path);
    try {
      legacy(db);
    } finally {
      db.close();
    }
  }
  await migrate(TASK_MIGRATION_CONTRIBUTION.migrations.length);
  return TaskRepositoryLive.pipe(Layer.provide(sql));
}

const isoNow = () => new Date().toISOString();

function taskInput(id: string, overrides: Partial<Task> = {}) {
  const at = isoNow();
  return {
    id: TaskId.make(id),
    projectId: project,
    title: id,
    description: "",
    output: null,
    status: "To Do",
    priority: null,
    createdBy: "test",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    metadata: null,
    tags: [],
    createdAt: at,
    updatedAt: at,
    closedAt: null,
    ...overrides,
  };
}

function agentInput(id: string, overrides: Partial<TaskAgent> = {}): TaskAgent {
  const at = isoNow();
  return {
    id: TaskAgentId.make(id),
    projectId: project,
    name: id,
    enabled: true,
    startStatuses: ["To Do"],
    startTags: [],
    startRunStatuses: [],
    config: { role: id, modelSelection, instructions: "Work." },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function runInput(
  id: string,
  taskId: string,
  agentId: string,
  overrides: Partial<TaskAgentRun> = {},
): TaskAgentRun {
  return {
    id: TaskAgentRunId.make(id),
    taskId: TaskId.make(taskId),
    agentId: TaskAgentId.make(agentId),
    threadId: ThreadId.make(`thread-${id}`),
    modelSelection,
    status: "running",
    startedAt: isoNow(),
    completedAt: null,
    triggerRunId: null,
    ...overrides,
  };
}

/** Finish a run the way the server does, so trigger bookkeeping matches production. */
const finish = (
  repository: TaskRepositoryShape,
  run: TaskAgentRun,
  status: string,
  taskStatus?: string,
) =>
  Effect.gen(function* () {
    yield* repository.claimAgentRunFinalization({
      id: run.id,
      finalizingStatus: `finalizing:${status}`,
    });
    yield* repository.finalizeAgentRun({
      id: run.id,
      finalizingStatus: `finalizing:${status}`,
      status,
      completedAt: isoNow(),
      taskId: run.taskId,
      ...(taskStatus !== undefined ? { taskStatus } : {}),
      releaseAssignment: true,
      events: [],
    });
  });

const tick = Effect.sleep("5 millis");

test("only real changes to trigger fields advance triggerChangedAt", async () => {
  const layer = await database();
  await Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const created = yield* repository.upsert(taskInput("t", { tags: ["a"] }));
      NodeAssert.equal(created.triggerChangedAt, created.createdAt);
      let last = created.triggerChangedAt;
      const expectUnchanged = (task: Task, label: string) =>
        NodeAssert.equal(task.triggerChangedAt, last, `${label} must not restart agents`);
      const expectChanged = (task: Task, label: string) => {
        NodeAssert.ok(Date.parse(task.triggerChangedAt) > Date.parse(last), `${label} must count`);
        last = task.triggerChangedAt;
      };

      yield* tick;
      expectUnchanged(yield* repository.update({ id: created.id, output: "progress" }), "output");
      expectUnchanged(
        yield* repository.update({ id: created.id, assigneeAgentRunId: "run-x" }),
        "assignment",
      );
      expectUnchanged(yield* repository.update({ id: created.id, metadata: { a: 1 } }), "metadata");
      expectUnchanged(yield* repository.update({ id: created.id, priority: "high" }), "priority");
      expectUnchanged(yield* repository.update({ id: created.id, status: "To Do" }), "same status");
      expectUnchanged(
        yield* repository.addTag({ taskId: created.id, tag: "a", updatedAt: isoNow() }),
        "re-adding a present tag",
      );
      expectUnchanged(
        yield* repository.removeTag({ taskId: created.id, tag: "missing", updatedAt: isoNow() }),
        "removing an absent tag",
      );

      expectChanged(yield* repository.update({ id: created.id, status: "Backlog" }), "status");
      yield* tick;
      expectChanged(
        yield* repository.addTag({ taskId: created.id, tag: "b", updatedAt: isoNow() }),
        "a new tag",
      );
      yield* tick;
      expectChanged(
        yield* repository.removeTag({ taskId: created.id, tag: "b", updatedAt: isoNow() }),
        "removing a tag",
      );
      yield* tick;
      expectChanged(
        yield* repository.update({ id: created.id, description: "more" }),
        "description",
      );
      yield* tick;
      const delayed = yield* repository.update({
        id: created.id,
        notBefore: "2030-01-01T12:00:00+02:00",
      });
      expectChanged(delayed, "notBefore");
      NodeAssert.equal(delayed.notBefore, "2030-01-01T10:00:00.000Z", "notBefore is stored as UTC");

      // A result that moves the status is a trigger change; one that keeps it is not.
      yield* tick;
      const run = yield* repository.createAgentRun(runInput("r1", "t", "agent"));
      yield* finish(repository, run, "completed", "Backlog");
      expectUnchanged(
        Option.getOrThrow(yield* repository.getById({ id: created.id })),
        "same result status",
      );
      const run2 = yield* repository.createAgentRun(runInput("r2", "t", "agent"));
      yield* finish(repository, run2, "completed", "Needs Review");
      expectChanged(
        Option.getOrThrow(yield* repository.getById({ id: created.id })),
        "result status",
      );
    }).pipe(Effect.provide(layer)),
  );
});

test("a run-status trigger is another agent's unhandled latest run, never one started by a run status", async () => {
  const layer = await database();
  await Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(taskInput("t"));
      const doctorCreatedAt = isoNow();
      yield* tick;
      const find = repository.findRunStatusTrigger({
        taskId: TaskId.make("t"),
        agentId: TaskAgentId.make("doctor"),
        statuses: ["failed", "blocked"],
        completedAfter: doctorCreatedAt,
      });

      const failed = yield* repository.createAgentRun(runInput("dev-1", "t", "dev"));
      yield* finish(repository, failed, "failed");
      NodeAssert.equal(Option.getOrNull(yield* find)?.id, "dev-1");

      // A newer run of the same agent supersedes the failure.
      yield* tick;
      const retried = yield* repository.createAgentRun(runInput("dev-2", "t", "dev"));
      NodeAssert.equal(Option.isNone(yield* find), true, "an active retry supersedes the failure");
      yield* finish(repository, retried, "completed");
      NodeAssert.equal(
        Option.isNone(yield* find),
        true,
        "a successful retry supersedes the failure",
      );

      yield* tick;
      const blocked = yield* repository.createAgentRun(runInput("dev-3", "t", "dev"));
      yield* finish(repository, blocked, "blocked");
      NodeAssert.equal(Option.getOrNull(yield* find)?.id, "dev-3");

      // Handled once the doctor has a run started after the failure.
      yield* tick;
      const doctorRun = yield* repository.createAgentRun(
        runInput("doctor-1", "t", "doctor", { triggerRunId: TaskAgentRunId.make("dev-3") }),
      );
      NodeAssert.equal(Option.isNone(yield* find), true);
      yield* finish(repository, doctorRun, "failed");
      NodeAssert.equal(
        Option.isNone(yield* find),
        true,
        "the doctor's own failure is not its trigger",
      );

      // A second doctor ignores runs that a run status started.
      const other = repository.findRunStatusTrigger({
        taskId: TaskId.make("t"),
        agentId: TaskAgentId.make("doctor-2"),
        statuses: ["failed", "blocked"],
        completedAfter: doctorCreatedAt,
      });
      NodeAssert.equal(Option.getOrNull(yield* other)?.id, "dev-3");

      // Failures before the waiting agent existed are history.
      const later = repository.findRunStatusTrigger({
        taskId: TaskId.make("t"),
        agentId: TaskAgentId.make("doctor-3"),
        statuses: ["failed", "blocked"],
        completedAfter: isoNow(),
      });
      NodeAssert.equal(Option.isNone(yield* later), true);
    }).pipe(Effect.provide(layer)),
  );
});

test("notBefore wakes only open tasks inside the swept window", async () => {
  const layer = await database();
  await Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(taskInput("due", { notBefore: "2030-01-01T10:00:00.000Z" }));
      yield* repository.upsert(taskInput("later", { notBefore: "2030-01-01T11:00:00.000Z" }));
      yield* repository.upsert(
        taskInput("closed", { notBefore: "2030-01-01T10:00:00.000Z", closedAt: isoNow() }),
      );
      const due = yield* repository.listTasksReachingNotBefore({
        after: "2030-01-01T09:59:59.000Z",
        until: "2030-01-01T10:00:00.000Z",
      });
      NodeAssert.deepEqual(
        due.map(({ id }) => id),
        ["due"],
      );
    }).pipe(Effect.provide(layer)),
  );
});

// --- Scheduler scenarios against the real repository -----------------------

interface Harness {
  readonly repository: TaskRepositoryShape;
  readonly service: TaskAgentServiceShape;
  readonly commands: OrchestrationCommand[];
  readonly sessions: Map<string, { status: string; lastError: string | null; latestTurn?: string }>;
}

function deterministicCrypto(): Layer.Layer<Crypto.Crypto> {
  let seed = 0;
  return Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => {
        seed += 1;
        return Uint8Array.from({ length: size }, (_, index) => (seed * 31 + index * 7) % 256);
      },
      digest: () => Effect.die("unused digest"),
    }),
  );
}

async function withScheduler(
  use: (harness: Harness) => Effect.Effect<void, unknown>,
  legacy?: (db: NodeSqlite.DatabaseSync) => void,
) {
  const repositoryLayer = await database(legacy);
  const commands: OrchestrationCommand[] = [];
  const sessions = new Map<
    string,
    { status: string; lastError: string | null; latestTurn?: string }
  >();
  const dependencies = Layer.mergeAll(
    repositoryLayer,
    Layer.succeed(TaskPromptSettingsStore, {
      get: Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
      update: () => Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
    } satisfies TaskPromptSettingsStoreShape),
    Layer.succeed(OrchestrationEngineService, {
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
    } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: (threadId: string) =>
        Effect.sync(() => {
          const session = sessions.get(threadId) ?? { status: "running", lastError: null };
          return Option.some({
            messages: [],
            session: {
              status: session.status,
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "full-access",
              activeTurnId: session.status === "running" ? "turn-1" : null,
              lastError: session.lastError,
              updatedAt: isoNow(),
            },
            latestTurn: session.latestTurn ? { state: session.latestTurn } : null,
          });
        }),
    } as never),
    deterministicCrypto(),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* TaskRepository;
        const service = yield* TaskAgentService;
        yield* use({ repository, service, commands, sessions });
      }).pipe(
        Effect.provide(
          Layer.merge(TaskAgentServiceLive.pipe(Layer.provide(dependencies)), repositoryLayer),
        ),
      ),
    ),
  );
}

const waitFor = <A>(
  label: string,
  probe: Effect.Effect<A | undefined, unknown>,
  timeoutMs = 4_000,
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = yield* probe;
      if (value !== undefined) return value;
      yield* Effect.sleep("20 millis");
    }
    return NodeAssert.fail(`timed out waiting for ${label}`);
  });

const runsOf = (repository: TaskRepositoryShape, taskId: string) =>
  repository.searchAgentRuns({ taskId: TaskId.make(taskId), limit: 50 });

const change = (harness: Harness, task: Task, releasedRunId?: TaskAgentRunId) =>
  harness.service.scheduleTaskChanged({
    task,
    reason: "updated",
    ...(releasedRunId ? { releasedRunId } : {}),
  });

test("several agents keep running on one task; a release completes only the releasing run", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service } = harness;
      yield* repository.upsertAgent(agentInput("a", { startTags: ["a"] }));
      yield* repository.upsertAgent(agentInput("b", { startTags: ["b"] }));
      const task = yield* repository.upsert(taskInput("t", { tags: ["a", "b"] }));
      yield* service.scheduleTaskChanged({ task, reason: "created" });
      const [first, second] = yield* waitFor(
        "both agents to start",
        runsOf(repository, "t").pipe(Effect.map((runs) => (runs.length === 2 ? runs : undefined))),
      );
      const runA = [first!, second!].find((run) => run.agentId === "a")!;
      const runB = [first!, second!].find((run) => run.agentId === "b")!;

      // A claims and moves the status: B no longer matches but keeps running.
      yield* change(
        harness,
        yield* repository.update({
          id: task.id,
          status: "In Progress",
          assigneeAgentRunId: runA.id,
        }),
      );
      yield* Effect.sleep("150 millis");
      const active = yield* repository.listActiveAgentRunsForTask({ id: task.id });
      NodeAssert.deepEqual(active.map(({ id }) => id).sort(), [runA.id, runB.id].sort());

      // B releases after A overwrote the assignment; only B ends, as completed.
      yield* change(
        harness,
        yield* repository.update({ id: task.id, assigneeAgentRunId: null }),
        runB.id,
      );
      const endedB = yield* waitFor(
        "B to end",
        repository
          .getAgentRunById({ id: runB.id })
          .pipe(
            Effect.map((run) =>
              Option.getOrThrow(run).completedAt ? Option.getOrThrow(run) : undefined,
            ),
          ),
      );
      NodeAssert.equal(endedB.status, "completed");
      NodeAssert.equal(
        Option.getOrThrow(yield* repository.getAgentRunById({ id: runA.id })).completedAt,
        null,
      );

      // Closing the task stops the rest.
      yield* change(harness, yield* repository.update({ id: task.id, closedAt: isoNow() }));
      const endedA = yield* waitFor(
        "A to stop",
        repository
          .getAgentRunById({ id: runA.id })
          .pipe(
            Effect.map((run) =>
              Option.getOrThrow(run).completedAt ? Option.getOrThrow(run) : undefined,
            ),
          ),
      );
      NodeAssert.equal(endedA.status, "stopped");
      NodeAssert.equal((yield* runsOf(repository, "t")).length, 2, "a closed task starts nothing");
    }),
  );
});

test("an agent restarts only after a trigger change, and an explicit stop is not undone", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service } = harness;
      yield* repository.upsertAgent(agentInput("dev"));
      const task = yield* repository.upsert(taskInput("t"));
      yield* service.scheduleTaskChanged({ task, reason: "created" });
      const first = yield* waitFor(
        "first run",
        runsOf(repository, "t").pipe(Effect.map((runs) => runs[0])),
      );

      const stopped = Option.getOrThrow(yield* service.stopRun({ id: first.id }));
      NodeAssert.equal(stopped.status, "stopped");

      // Output and assignment changes leave the stopped run alone.
      yield* change(
        harness,
        yield* repository.update({ id: task.id, output: "note", assigneeAgentRunId: null }),
      );
      yield* Effect.sleep("150 millis");
      NodeAssert.equal((yield* runsOf(repository, "t")).length, 1);

      // Re-entering the trigger status after the stop starts it again.
      yield* tick;
      yield* change(harness, yield* repository.update({ id: task.id, status: "Backlog" }));
      yield* change(harness, yield* repository.update({ id: task.id, status: "To Do" }));
      yield* waitFor(
        "second run",
        runsOf(repository, "t").pipe(Effect.map((runs) => (runs.length === 2 ? runs : undefined))),
      );
    }),
  );
});

test("a run-status agent handles each failure once and a failed run is not replayed", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, commands, sessions } = harness;
      yield* repository.upsertAgent(agentInput("dev"));
      yield* repository.upsertAgent(
        agentInput("doctor", { startStatuses: [], startRunStatuses: ["failed"] }),
      );
      const task = yield* repository.upsert(taskInput("t"));
      yield* service.scheduleTaskChanged({ task, reason: "created" });
      const devRun = yield* waitFor(
        "developer run",
        runsOf(repository, "t").pipe(Effect.map((runs) => runs[0])),
      );
      NodeAssert.equal(devRun.agentId, "dev", "the doctor does not start on task state alone");

      sessions.set(devRun.threadId, { status: "error", lastError: "quota exhausted" });
      const doctorRun = yield* waitFor(
        "doctor run",
        runsOf(repository, "t").pipe(
          Effect.map((runs) => runs.find((run) => run.agentId === "doctor")),
        ),
      );
      NodeAssert.equal(doctorRun.triggerRunId, devRun.id);
      const prompt = commands.findLast(
        (command) =>
          command.type === "thread.turn.start" && command.threadId === doctorRun.threadId,
      );
      NodeAssert.ok(prompt?.type === "thread.turn.start");
      NodeAssert.match(prompt.message.text, /Triggering run:/);
      NodeAssert.match(prompt.message.text, /reason: quota exhausted/);

      // The doctor fails too: nobody starts again.
      sessions.set(doctorRun.threadId, { status: "error", lastError: "quota exhausted" });
      yield* waitFor(
        "doctor failure",
        repository
          .getAgentRunById({ id: doctorRun.id })
          .pipe(
            Effect.map((run) => (Option.getOrThrow(run).status === "failed" ? true : undefined)),
          ),
      );
      yield* Effect.sleep("300 millis");
      const runs = yield* runsOf(repository, "t");
      NodeAssert.deepEqual(runs.map(({ agentId, status }) => `${agentId}:${status}`).sort(), [
        "dev:failed",
        "doctor:failed",
      ]);

      // The doctor's retry is a trigger change; the developer then runs again.
      yield* change(harness, yield* repository.update({ id: task.id, notBefore: isoNow() }));
      yield* waitFor(
        "developer retry",
        runsOf(repository, "t").pipe(
          Effect.map((all) =>
            all.filter((run) => run.agentId === "dev").length === 2 ? true : undefined,
          ),
        ),
      );
    }),
  );
});

test("notBefore holds a matching task until its time", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service } = harness;
      yield* repository.upsertAgent(agentInput("dev"));
      const task = yield* repository.upsert(
        taskInput("t", { notBefore: new Date(Date.now() + 1_000).toISOString() }),
      );
      yield* service.scheduleTaskChanged({ task, reason: "created" });
      yield* Effect.sleep("300 millis");
      NodeAssert.equal((yield* runsOf(repository, "t")).length, 0);
      yield* waitFor(
        "run after notBefore",
        runsOf(repository, "t").pipe(Effect.map((runs) => runs[0])),
        8_000,
      );
    }),
  );
});

test("after the upgrade, finished work in a start status is not replayed and unstarted work still starts", async () => {
  const at = (minute: number) => `2026-09-30T10:${String(minute).padStart(2, "0")}:00.000Z`;
  await withScheduler(
    (harness) =>
      Effect.gen(function* () {
        const { repository, service } = harness;
        yield* service.recover;
        yield* waitFor(
          "the never-run task to start",
          runsOf(repository, "fresh").pipe(Effect.map((runs) => runs[0])),
        );
        yield* Effect.sleep("300 millis");
        NodeAssert.equal(
          (yield* runsOf(repository, "finished")).length,
          1,
          "a completed run edited later is not replayed",
        );
        NodeAssert.equal(
          (yield* runsOf(repository, "failed")).length,
          1,
          "a failed run is not replayed",
        );
        NodeAssert.equal(
          Option.getOrThrow(yield* repository.getById({ id: TaskId.make("finished") }))
            .triggerChangedAt,
          at(5),
        );
      }),
    (db) => {
      db.prepare(`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json,
        start_tags_json, config_json, concurrency_key, created_at, updated_at)
        VALUES ('dev', 'project-1', 'Dev', 1, '["To Do"]', '[]', ?, 'legacy-key', ?, ?)`).run(
        JSON.stringify({ role: "Dev", modelSelection, instructions: "Work." }),
        at(0),
        at(0),
      );
      const task = db.prepare(`INSERT INTO tasks (id, rank, project_id, title, description, output,
        status, priority, created_by, assignee_worker_id, source_thread_id, source_run_id,
        metadata_json, created_at, updated_at, closed_at)
        VALUES (?, ?, 'project-1', ?, '', NULL, 'To Do', NULL, 'test', NULL, NULL, NULL, 'null', ?, ?, NULL)`);
      const run = db.prepare(`INSERT INTO task_agent_runs (id, task_id, agent_id, thread_id,
        model_selection_json, status, started_at, completed_at)
        VALUES (?, ?, 'dev', ?, ?, ?, ?, ?)`);
      // Finished at :05, then its output was edited at :09.
      task.run("finished", "0000000100000000", "Finished", at(1), at(9));
      run.run(
        "run-finished",
        "finished",
        "thread-finished",
        JSON.stringify(modelSelection),
        "completed",
        at(2),
        at(5),
      );
      // Failed before claiming, still in To Do.
      task.run("failed", "0000000200000000", "Failed", at(1), at(6));
      run.run(
        "run-failed",
        "failed",
        "thread-failed",
        JSON.stringify(modelSelection),
        "failed",
        at(3),
        at(6),
      );
      task.run("fresh", "0000000300000000", "Fresh", at(1), at(1));
    },
  );
});

test("a person stopping the session or interrupting the turn stops the run without triggering run-status agents", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, sessions } = harness;
      yield* repository.upsertAgent(agentInput("dev"));
      yield* repository.upsertAgent(
        agentInput("doctor", { startStatuses: [], startRunStatuses: ["failed", "interrupted"] }),
      );
      for (const id of ["stopped", "interrupted-turn", "stop-after-error"]) {
        yield* service.scheduleTaskChanged({
          task: yield* repository.upsert(taskInput(id)),
          reason: "created",
        });
      }
      const devRun = (taskId: string) =>
        waitFor(`run on ${taskId}`, runsOf(repository, taskId).pipe(Effect.map((runs) => runs[0])));
      const ended = (taskId: string) =>
        waitFor(
          `run on ${taskId} to end`,
          runsOf(repository, taskId).pipe(
            Effect.map((runs) =>
              runs.find((run) => run.agentId === "dev" && run.completedAt !== null),
            ),
          ),
        );

      sessions.set((yield* devRun("stopped")).threadId, { status: "stopped", lastError: null });
      NodeAssert.equal((yield* ended("stopped")).status, "stopped");

      sessions.set((yield* devRun("stop-after-error")).threadId, {
        status: "stopped",
        lastError: "interrupt failed",
      });
      NodeAssert.equal((yield* ended("stop-after-error")).status, "failed");
      yield* waitFor(
        "the doctor for the real failure",
        runsOf(repository, "stop-after-error").pipe(
          Effect.map((runs) => runs.find((run) => run.agentId === "doctor")),
        ),
      );

      sessions.set((yield* devRun("interrupted-turn")).threadId, {
        status: "ready",
        lastError: null,
        latestTurn: "interrupted",
      });
      // Outside startup the interrupted turn keeps its grace period; recovery settles it.
      yield* service.recover;
      NodeAssert.equal((yield* ended("interrupted-turn")).status, "stopped");
      yield* Effect.sleep("200 millis");
      for (const id of ["stopped", "interrupted-turn"]) {
        NodeAssert.deepEqual(
          (yield* runsOf(repository, id)).map(({ agentId }) => agentId),
          ["dev"],
        );
      }
    }),
  );
});
