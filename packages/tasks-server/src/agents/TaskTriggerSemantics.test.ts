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
import * as Fiber from "effect/Fiber";
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
    continuesRunId: null,
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

interface FakeSession {
  status: string;
  lastError: string | null;
  latestTurn?: string;
  /** Defaults to now, i.e. a session the provider just updated. */
  updatedAt?: string;
  messages?: ReadonlyArray<{ role: string; text: string; streaming: boolean; updatedAt: string }>;
}

interface Harness {
  readonly repository: TaskRepositoryShape;
  readonly service: TaskAgentServiceShape;
  readonly commands: OrchestrationCommand[];
  readonly sessions: Map<string, FakeSession>;
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
  /** Wraps the scheduler's repository, e.g. to pause a call and force an interleaving. */
  wrapRepository?: (repository: TaskRepositoryShape) => TaskRepositoryShape,
) {
  const repositoryLayer = await database(legacy);
  const schedulerRepositoryLayer = wrapRepository
    ? Layer.effect(
        TaskRepository,
        Effect.gen(function* () {
          return wrapRepository(yield* TaskRepository);
        }),
      ).pipe(Layer.provide(repositoryLayer))
    : repositoryLayer;
  const commands: OrchestrationCommand[] = [];
  const sessions = new Map<string, FakeSession>();
  const dependencies = Layer.mergeAll(
    schedulerRepositoryLayer,
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
            deletedAt: null,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            messages: session.messages ?? [],
            session: {
              status: session.status,
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "full-access",
              activeTurnId: session.status === "running" ? "turn-1" : null,
              lastError: session.lastError,
              updatedAt: session.updatedAt ?? isoNow(),
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
        NodeAssert.equal(
          (yield* runsOf(repository, "shared")).length,
          2,
          "an agent that finished before another agent on the same task is not replayed",
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
      // Two agents worked on one task: the developer finished at :04, the reviewer at :05.
      db.prepare(`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json,
        start_tags_json, config_json, concurrency_key, created_at, updated_at)
        VALUES ('reviewer', 'project-1', 'Reviewer', 1, '["To Do"]', '["shared"]', ?, NULL, ?, ?)`).run(
        JSON.stringify({ role: "Reviewer", modelSelection, instructions: "Review." }),
        at(0),
        at(0),
      );
      task.run("shared", "0000000400000000", "Shared", at(1), at(5));
      db.prepare("INSERT INTO task_tags (task_id, tag) VALUES ('shared', 'shared')").run();
      run.run(
        "run-shared-dev",
        "shared",
        "thread-shared-dev",
        JSON.stringify(modelSelection),
        "completed",
        at(2),
        at(4),
      );
      db.prepare(`INSERT INTO task_agent_runs (id, task_id, agent_id, thread_id,
        model_selection_json, status, started_at, completed_at)
        VALUES ('run-shared-reviewer', 'shared', 'reviewer', 'thread-shared-reviewer', ?, 'completed', ?, ?)`).run(
        JSON.stringify(modelSelection),
        at(4),
        at(5),
      );
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

// --- agent_run_message --------------------------------------------------------

const resultMessage = (status: string, summary: string, updatedAt: string) => ({
  role: "assistant",
  streaming: false,
  updatedAt,
  text: `Done.\n~~~task_agent_result\n${JSON.stringify({ status, summary, blocked: false, events: [] })}\n~~~`,
});

const turnsTo = (commands: ReadonlyArray<OrchestrationCommand>, threadId: string) =>
  commands.flatMap((command) =>
    command.type === "thread.turn.start" && command.threadId === threadId
      ? [command.message.text]
      : [],
  );

/** An agent no task state starts, so every run in these tests is explicit. */
const idleAgent = (id: string, overrides: Partial<TaskAgent> = {}) =>
  agentInput(id, { startStatuses: ["Never"], ...overrides });

test("messaging an active run sends its next turn and creates no run", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, commands } = harness;
      yield* repository.upsertAgent(idleAgent("dev"));
      yield* repository.upsert(taskInput("t"));
      const run = yield* repository.createAgentRun(runInput("r1", "t", "dev"));

      const result = yield* service.messageRun({ id: run.id, text: "Also check the docs." });
      NodeAssert.deepEqual(result, { ok: true, run, continued: false });
      NodeAssert.deepEqual(turnsTo(commands, run.threadId), ["Also check the docs."]);
      NodeAssert.equal((yield* runsOf(repository, "t")).length, 1);
    }),
  );
});

test("messaging an ended run continues it in its thread, and its own result finishes the continuation", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, commands, sessions } = harness;
      yield* repository.upsertAgent(idleAgent("dev"));
      // How each previous run left its thread; none of it may end the continuation.
      const before = "2026-01-01T00:00:00.000Z";
      const ended = {
        completed: {
          status: "ready",
          lastError: null,
          updatedAt: before,
          messages: [resultMessage("Needs Review", "old result", before)],
        },
        failed: { status: "error", lastError: "usage limit", updatedAt: before },
        stopped: { status: "stopped", lastError: null, updatedAt: before },
      } satisfies Record<string, FakeSession>;
      const previous = new Map<string, TaskAgentRun>();
      for (const [status, session] of Object.entries(ended)) {
        // notBefore gates trigger starts only, never an explicit message.
        yield* repository.upsert(
          taskInput(status, { notBefore: new Date(Date.now() + 3_600_000).toISOString() }),
        );
        const run = yield* repository.createAgentRun(runInput(`${status}-1`, status, "dev"));
        yield* finish(repository, run, status);
        sessions.set(run.threadId, session);
        previous.set(status, run);
      }
      yield* tick;

      const continuations = new Map<string, TaskAgentRun>();
      for (const [status, run] of previous) {
        const result = yield* service.messageRun({ id: run.id, text: "The limit reset; go on." });
        NodeAssert.ok(result.ok, status);
        NodeAssert.equal(result.continued, true);
        NodeAssert.equal(result.run.threadId, run.threadId, "same thread");
        NodeAssert.equal(result.run.continuesRunId, run.id);
        NodeAssert.equal(result.run.triggerRunId, null);
        NodeAssert.equal(result.run.status, "running");
        const [turn] = turnsTo(commands, run.threadId);
        NodeAssert.match(turn!, new RegExp(`agentRunId: ${result.run.id}`));
        NodeAssert.match(turn!, /The limit reset; go on\.$/);
        NodeAssert.equal(
          Option.getOrThrow(yield* repository.getAgentRunById({ id: run.id })).status,
          status,
          "the messaged run keeps its status",
        );
        continuations.set(status, result.run);
      }

      // Reconciliation ticks see the previous run's session and result, which
      // predate the continuation: the continuation keeps running.
      yield* Effect.sleep("1300 millis");
      for (const [status, run] of continuations) {
        NodeAssert.equal(
          Option.getOrThrow(yield* repository.getAgentRunById({ id: run.id })).completedAt,
          null,
          `${status} continuation still running`,
        );
      }

      for (const [status, run] of continuations) {
        const at = isoNow();
        sessions.set(run.threadId, {
          status: "ready",
          lastError: null,
          updatedAt: at,
          messages: [resultMessage("Needs Review", `continued ${status}`, at)],
        });
      }
      for (const [status, run] of continuations) {
        const finished = yield* waitFor(
          `${status} continuation result`,
          repository.getAgentRunById({ id: run.id }).pipe(
            Effect.map((found) => {
              const current = Option.getOrThrow(found);
              return current.completedAt ? current : undefined;
            }),
          ),
        );
        NodeAssert.equal(finished.status, "completed");
        const task = Option.getOrThrow(yield* repository.getById({ id: TaskId.make(status) }));
        NodeAssert.equal(task.status, "Needs Review");
        NodeAssert.equal(task.output, `continued ${status}`);
      }
    }),
  );
});

test("messaging refuses another active run of the agent, a closed task, and a disabled agent", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, commands } = harness;
      yield* repository.upsertAgent(idleAgent("dev"));
      yield* repository.upsert(taskInput("t"));
      const ended = yield* repository.createAgentRun(runInput("r1", "t", "dev"));
      yield* finish(repository, ended, "failed");
      yield* tick;
      const active = yield* repository.createAgentRun(runInput("r2", "t", "dev"));

      const busy = yield* service.messageRun({ id: ended.id, text: "go" });
      NodeAssert.ok(!busy.ok);
      NodeAssert.equal(busy.activeRunId, active.id);
      NodeAssert.match(busy.error, /active run 'r2'.*Message that run instead/);

      yield* finish(repository, active, "completed");
      yield* repository.update({ id: TaskId.make("t"), closedAt: isoNow() });
      const closed = yield* service.messageRun({ id: ended.id, text: "go" });
      NodeAssert.ok(!closed.ok);
      NodeAssert.match(closed.error, /is closed/);

      yield* repository.update({ id: TaskId.make("t"), closedAt: null });
      yield* repository.upsertAgent(idleAgent("dev", { enabled: false }));
      const disabled = yield* service.messageRun({ id: ended.id, text: "go" });
      NodeAssert.ok(!disabled.ok);
      NodeAssert.match(disabled.error, /is disabled/);

      const missing = yield* service.messageRun({ id: TaskAgentRunId.make("nope"), text: "go" });
      NodeAssert.ok(!missing.ok);
      NodeAssert.match(missing.error, /'nope' was not found/);

      NodeAssert.equal((yield* runsOf(repository, "t")).length, 2, "no run was created");
      NodeAssert.equal(commands.length, 0, "no turn was sent");
    }),
  );
});

test("a failed continuation triggers a run-status agent once", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, sessions } = harness;
      yield* repository.upsertAgent(idleAgent("dev"));
      yield* repository.upsertAgent(
        agentInput("doctor", { startStatuses: [], startRunStatuses: ["failed"] }),
      );
      yield* repository.upsert(taskInput("t"));
      yield* tick;
      const run = yield* repository.createAgentRun(runInput("r1", "t", "dev"));
      yield* finish(repository, run, "completed");
      sessions.set(run.threadId, {
        status: "ready",
        lastError: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const result = yield* service.messageRun({ id: run.id, text: "One more thing." });
      NodeAssert.ok(result.ok);
      const continuation = result.run;
      sessions.set(continuation.threadId, { status: "error", lastError: "usage limit" });
      const doctorRun = yield* waitFor(
        "doctor run",
        runsOf(repository, "t").pipe(
          Effect.map((runs) => runs.find((candidate) => candidate.agentId === "doctor")),
        ),
      );
      NodeAssert.equal(doctorRun.triggerRunId, continuation.id);
      NodeAssert.equal(
        Option.getOrThrow(yield* repository.getAgentRunById({ id: continuation.id })).status,
        "failed",
      );

      yield* finish(repository, doctorRun, "completed");
      yield* service.scheduleTaskChanged({
        task: Option.getOrThrow(yield* repository.getById({ id: TaskId.make("t") })),
        reason: "run-finished",
      });
      yield* Effect.sleep("300 millis");
      NodeAssert.equal(
        (yield* runsOf(repository, "t")).filter((candidate) => candidate.agentId === "doctor")
          .length,
        1,
      );
    }),
  );
});

test("a queued change uses the stored task, so closing or disabling before it is processed starts nothing", async () => {
  await withScheduler((harness) =>
    Effect.gen(function* () {
      const { repository, service, commands } = harness;
      yield* repository.upsertAgent(agentInput("dev"));
      // The job carries the task as it was when queued; the task is closed before it runs.
      const queued = yield* repository.upsert(taskInput("closed-later"));
      yield* repository.update({ id: queued.id, closedAt: isoNow() });
      yield* service.scheduleTaskChanged({ task: queued, reason: "created" });
      yield* Effect.sleep("300 millis");
      NodeAssert.equal((yield* runsOf(repository, "closed-later")).length, 0);
      // Same for an agent disabled after the change was queued.
      const open = yield* repository.upsert(taskInput("agent-disabled-later"));
      yield* repository.upsertAgent({ ...agentInput("dev"), enabled: false });
      yield* service.scheduleTaskChanged({ task: open, reason: "created" });
      yield* Effect.sleep("300 millis");
      NodeAssert.equal((yield* runsOf(repository, "agent-disabled-later")).length, 0);
      NodeAssert.equal(
        commands.filter((command) => command.type === "thread.create").length,
        0,
        "no provider thread starts",
      );
    }),
  );
});

test("a delayed duplicate stop of a finished run leaves the continuation on its thread alone", async () => {
  const gate = { release: () => {}, paused: false };
  const released = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  let pauseNextStopClaim = false;
  await withScheduler(
    (harness) =>
      Effect.gen(function* () {
        const { repository, service, commands } = harness;
        yield* repository.upsertAgent(agentInput("dev"));
        const task = yield* repository.upsert(taskInput("t"));
        yield* service.scheduleTaskChanged({ task, reason: "created" });
        const first = yield* waitFor(
          "first run",
          runsOf(repository, "t").pipe(Effect.map((runs) => runs[0])),
        );

        // Stop A claims finalization and pauses; stop B (same claim kind) and a
        // continuation message arrive meanwhile. They must wait for A, so neither
        // can be undone by A's late session stop.
        pauseNextStopClaim = true;
        const stopA = yield* Effect.forkChild(service.stopRun({ id: first.id }));
        yield* waitFor(
          "stop A to pause",
          Effect.sync(() => (gate.paused ? true : undefined)),
        );
        const stopB = yield* Effect.forkChild(service.stopRun({ id: first.id }));
        const message = yield* Effect.forkChild(
          service.messageRun({ id: first.id, text: "Continue." }),
        );
        yield* Effect.sleep("100 millis");
        NodeAssert.equal(
          commands.filter((command) => command.type === "thread.turn.start").length,
          1,
          "the continuation waits for the finalizer that holds the thread",
        );

        gate.release();
        yield* Fiber.join(stopA);
        yield* Fiber.join(stopB);
        const continued = yield* Fiber.join(message);
        NodeAssert.equal(continued.ok, true);
        const startIndex = commands.findLastIndex(
          (command) => command.type === "thread.turn.start",
        );
        NodeAssert.deepEqual(
          commands.slice(startIndex + 1).map(({ type }) => type),
          [],
          "no stop after the continuation's turn",
        );
        const runs = yield* runsOf(repository, "t");
        NodeAssert.equal(runs.filter((run) => run.completedAt === null).length, 1);
      }),
    undefined,
    (repository) => ({
      ...repository,
      claimAgentRunFinalization: (input) =>
        repository.claimAgentRunFinalization(input).pipe(
          Effect.tap(() =>
            pauseNextStopClaim && input.finalizingStatus === "finalizing:stopped"
              ? Effect.promise(() => {
                  pauseNextStopClaim = false;
                  gate.paused = true;
                  return released;
                })
              : Effect.void,
          ),
        ),
    }),
  );
});

test("a close, postponement or agent deletion between the start checks and the run insert prevents the start", async () => {
  const pause: { taskId: string | null; reached: boolean; release: () => void } = {
    taskId: null,
    reached: false,
    release: () => {},
  };
  await withScheduler(
    (harness) =>
      Effect.gen(function* () {
        const { repository, service, commands } = harness;
        const cases = [
          {
            id: "closed-meanwhile",
            cancel: (taskId: TaskId) => repository.update({ id: taskId, closedAt: isoNow() }),
          },
          {
            id: "postponed-meanwhile",
            cancel: (taskId: TaskId) =>
              repository.update({
                id: taskId,
                notBefore: new Date(Date.now() + 3_600_000).toISOString(),
              }),
          },
          {
            id: "agent-deleted-meanwhile",
            cancel: () => repository.deleteAgent({ id: TaskAgentId.make("dev") }),
          },
        ] as const;
        for (const { id, cancel } of cases) {
          yield* repository.upsertAgent(agentInput("dev"));
          const task = yield* repository.upsert(taskInput(id));
          const released = new Promise<void>((resolve) => {
            pause.release = resolve;
          });
          pause.taskId = id;
          pause.reached = false;
          yield* service.scheduleTaskChanged({ task, reason: "created" });
          // The scheduler passed its eligibility checks and is about to insert the run.
          yield* waitFor(
            `start of ${id} to pause`,
            Effect.sync(() => (pause.reached ? true : undefined)),
          );
          yield* cancel(task.id);
          pause.release();
          yield* Effect.sleep("200 millis");
          NodeAssert.equal((yield* runsOf(repository, id)).length, 0, id);
          void released;
        }
        NodeAssert.equal(commands.filter((command) => command.type === "thread.create").length, 0);
      }),
    undefined,
    (repository) => ({
      ...repository,
      // The history lookup runs after the eligibility checks and before the insert.
      searchAgentRuns: (input) =>
        repository.searchAgentRuns(input).pipe(
          Effect.tap(() =>
            pause.taskId !== null && input.taskId === pause.taskId
              ? Effect.promise(
                  () =>
                    new Promise<void>((resolve) => {
                      pause.reached = true;
                      pause.taskId = null;
                      const release = pause.release;
                      pause.release = () => {
                        release();
                        resolve();
                      };
                    }),
                )
              : Effect.void,
          ),
        ),
    }),
  );
});
