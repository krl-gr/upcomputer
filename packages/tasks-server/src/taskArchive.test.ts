import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  TASK_ARCHIVED_EVENT,
  TASK_HISTORY_EVENT_KINDS,
  TASK_STATUS_CHANGED_EVENT,
  TASK_UNARCHIVED_EVENT,
  TASKS_RPC_METHODS,
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  TasksRpcGroup,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as RpcClient from "effect/unstable/rpc/RpcClient";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterEach } from "vite-plus/test";

import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../apps/server/src/extensionApi.ts";
import * as ServerSettings from "../../../apps/server/src/serverSettings.ts";
import { makeTaskAgentResultConsumer } from "./agents/TaskAgentResultFinalization.ts";
import {
  TaskAgentService,
  type TaskAgentServiceShape,
  type TaskChangedInput,
} from "./agents/TaskAgentService.ts";
import {
  TaskToolContextResolver,
  type TaskToolContextResolverShape,
} from "./context/TaskToolContextResolver.ts";
import { AllChatsInstructionsLive } from "./persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./persistence/migrations/index.ts";
import { TaskPromptSettingsStoreLive } from "./persistence/TaskPromptSettingsStore.ts";
import { TaskRepository, type PersistTaskInput } from "./persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "./persistence/TaskRepositoryLive.ts";
import { TASKS_RPC_CONTRIBUTION } from "./rpc/contributions.ts";
import { TaskToolService, TaskToolServiceLive } from "./tools/TaskToolService.ts";
import type { TaskToolInvocationContext } from "./tools/TaskToolTypes.ts";

const timestamp = "2026-10-07T10:00:00.000Z";
const project = ProjectId.make("project-1");
const person = { type: "person" } as const;
const chatThread = ThreadId.make("thread-chat");
const chat: TaskToolInvocationContext = {
  source: "provider",
  mutationPolicy: "allow",
  threadId: chatThread,
};
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

const task = (id: string, overrides: Partial<PersistTaskInput> = {}): PersistTaskInput => ({
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
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  ...overrides,
});

/** Fresh storage, the task tools and the Tasks RPC, with agent scheduling recorded. */
function harness() {
  const scheduled: TaskChangedInput[] = [];
  const agents = {
    scheduleTaskChanged: (input: TaskChangedInput) => Effect.sync(() => void scheduled.push(input)),
  } as unknown as TaskAgentServiceShape;
  const sql = NodeSqliteClient.layer({ filename: ":memory:" });
  const database = Layer.effectDiscard(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
  ).pipe(Layer.provideMerge(sql));
  const storage = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provideMerge(AllChatsInstructionsLive),
    Layer.provideMerge(
      Layer.mergeAll(
        database,
        NodeServices.layer,
        ServerSettings.layerTest({ customInstructions: "" }),
      ),
    ),
  );
  const resolver: TaskToolContextResolverShape = {
    resolve: () => Effect.succeed({ projects: [], resolvedProject: null } as never),
  };
  const layer = TaskToolServiceLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        storage,
        Layer.succeed(TaskToolContextResolver, resolver),
        Layer.succeed(TaskAgentService, agents),
        Layer.succeed(ThreadManagementService, {} as never),
        Layer.succeed(ProjectStoreV2, {} as never),
      ),
    ),
  );
  const call = (
    name: string,
    args: Record<string, unknown>,
    context: TaskToolInvocationContext = chat,
  ) =>
    Effect.gen(function* () {
      const result = yield* (yield* TaskToolService).call({ name, args, context });
      assert.equal(result.isError, false, result.text);
      return JSON.parse(result.text);
    });
  /** The Tasks view goes through the RPC. */
  const rpc = <A, E>(
    use: (client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof TasksRpcGroup>>) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      return yield* use(yield* RpcTest.makeClient(TasksRpcGroup));
    }).pipe(
      Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never })),
      Effect.scoped,
    );
  return { layer, scheduled, call, rpc };
}

const historyOf = (id: string) =>
  Effect.gen(function* () {
    const { events } = yield* (yield* TaskRepository).events({
      taskId: TaskId.make(id),
      kinds: [...TASK_HISTORY_EVENT_KINDS],
    });
    return events.map(({ kind, payload }) => ({ kind, payload }));
  });

it.effect("the migration archives every closed task and keeps open ones active", () =>
  Effect.gen(function* () {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tasks-archive-"));
    directories.push(directory);
    const filename = NodePath.join(directory, "tasks.sqlite");
    const sql = NodeSqliteClient.layer({ filename });
    const before = {
      ...TASK_MIGRATION_CONTRIBUTION,
      migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(({ version }) => version <= 18),
    };
    yield* runExperimentalFeatureMigrations([before]).pipe(Effect.provide(sql));
    // Rows as the previous schema stored them.
    const db = new NodeSqlite.DatabaseSync(filename);
    const insert = db.prepare(`INSERT INTO tasks (id, rank, project_id, title, description,
      status, created_by, metadata_json, created_at, updated_at, closed_at, trigger_changed_at)
      VALUES (?, ?, 'project-1', ?, '', ?, 'test', 'null', ?, ?, ?, ?)`);
    insert.run(
      "closed",
      "0000000100000000",
      "closed",
      "done",
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );
    insert.run("open", "0000000200000000", "open", "Done", timestamp, timestamp, null, timestamp);
    db.close();

    yield* Effect.gen(function* () {
      yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
      const repository = yield* TaskRepository;
      const closed = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("closed") }));
      const open = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("open") }));
      assert.equal(closed.archivedAt, timestamp);
      assert.equal(closed.status, "done");
      assert.equal(open.archivedAt, null);
      assert.equal(open.status, "Done");
      const ids = (archive: "active" | "archived" | "all") =>
        repository
          .page({ archive, limit: 10 })
          .pipe(Effect.map((page) => page.tasks.map(({ id }) => id)));
      assert.deepStrictEqual(yield* ids("active"), ["open"]);
      assert.deepStrictEqual(yield* ids("archived"), ["closed"]);
      assert.deepStrictEqual(yield* ids("all"), ["closed", "open"]);
      // The migration records no history: there is no data for past changes.
      const sqlClient = yield* SqlClient.SqlClient;
      const events = yield* sqlClient<{ n: number }>`SELECT COUNT(*) AS n FROM task_events`;
      assert.equal(events[0]!.n, 0);
    }).pipe(Effect.provide(TaskRepositoryLive.pipe(Layer.provideMerge(sql))));
  }),
);

it.effect("archive modes filter search, pages, status facets and counters", () => {
  const { layer } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const root = ThreadId.make("thread-root");
    yield* repository.upsert(task("active", { sourceThreadId: root, status: "To Do" }));
    yield* repository.upsert(task("hidden", { sourceThreadId: root, status: "Obsolete" }));
    for (const [id, taskId] of [
      ["run-active", "active"],
      ["run-hidden", "hidden"],
    ] as const)
      yield* repository.createAgentRun({
        id: TaskAgentRunId.make(id),
        taskId: TaskId.make(taskId),
        agentId: TaskAgentId.make("agent"),
        threadId: ThreadId.make(`thread-${id}`),
        modelSelection,
        status: "completed",
        startedAt: timestamp,
        completedAt: timestamp,
        triggerRunId: null,
        continuesRunId: null,
      });
    yield* repository.setArchived({ ids: [TaskId.make("hidden")], archived: true, actor: person });

    const searched = (archive?: "active" | "archived" | "all") =>
      repository
        .search(archive === undefined ? {} : { archive })
        .pipe(Effect.map((tasks) => tasks.map(({ id }) => id)));
    assert.deepStrictEqual(yield* searched(), ["active"]);
    assert.deepStrictEqual(yield* searched("archived"), ["hidden"]);
    assert.deepStrictEqual((yield* searched("all")).toSorted(), ["active", "hidden"]);

    assert.deepStrictEqual((yield* repository.page({})).statuses, ["To Do"]);
    assert.deepStrictEqual((yield* repository.page({ archive: "archived" })).statuses, [
      "Obsolete",
    ]);
    assert.deepStrictEqual((yield* repository.runCounts()).runCounts, [
      { status: "completed", count: 1 },
    ]);
    const thread = yield* repository.threadRunCounts({ threadIds: [root] });
    assert.deepStrictEqual(thread.threads[0]?.runCounts, [{ status: "completed", count: 1 }]);
    const threadTasks = yield* repository.threadTasks({ threadId: root });
    assert.deepStrictEqual(
      threadTasks.tasks.map(({ id }) => id),
      ["active"],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("archiving keeps the status, records reasons, and reports each id", () => {
  const { layer, scheduled, call } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* repository.upsert(task("a", { status: "In Progress" }));
    yield* repository.upsert(task("b"));
    yield* repository.upsert(task("c"));
    yield* repository.setArchived({ ids: [TaskId.make("c")], archived: true, actor: person });
    scheduled.length = 0;

    const archived = yield* call("task_archive", {
      ids: ["a", "b", "c", "missing"],
      reason: "Cleanup the owner asked for",
    });
    assert.deepStrictEqual(archived.results, [
      { id: "a", outcome: "archived" },
      { id: "b", outcome: "archived" },
      { id: "c", outcome: "already-archived" },
      { id: "missing", outcome: "not-found" },
    ]);
    const a = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("a") }));
    assert.equal(a.status, "In Progress");
    assert.notEqual(a.archivedAt, null);
    assert.deepStrictEqual(
      scheduled.map(({ task, reason }) => [task.id, reason]),
      [
        ["a", "archived"],
        ["b", "archived"],
      ],
    );
    assert.deepStrictEqual(yield* historyOf("a"), [
      {
        kind: TASK_ARCHIVED_EVENT,
        payload: {
          actor: { type: "thread", threadId: chatThread },
          reason: "Cleanup the owner asked for",
        },
      },
    ]);
    // A plain update cannot archive or unarchive.
    yield* repository.upsert({ ...a, archivedAt: null, title: "renamed" });
    assert.notEqual(
      Option.getOrThrow(yield* repository.getById({ id: TaskId.make("a") })).archivedAt,
      null,
    );

    const unarchived = yield* call("task_unarchive", { ids: ["a", "missing", "never"] });
    assert.deepStrictEqual(unarchived.results, [
      { id: "a", outcome: "unarchived" },
      { id: "missing", outcome: "not-found" },
      { id: "never", outcome: "not-found" },
    ]);
    const restored = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("a") }));
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.status, "In Progress");
    assert.deepStrictEqual(
      (yield* historyOf("a")).map(({ kind }) => kind),
      [TASK_UNARCHIVED_EVENT, TASK_ARCHIVED_EVENT],
    );
    const notArchived = yield* call("task_unarchive", { ids: ["b", "b"] });
    assert.deepStrictEqual(
      notArchived.results.map(({ outcome }: { outcome: string }) => outcome),
      ["unarchived", "not-archived"],
    );

    const searchedDefault = yield* call("task_search", {});
    assert.deepStrictEqual(searchedDefault.tasks.map(({ id }: { id: string }) => id).toSorted(), [
      "a",
      "b",
    ]);
    const searchedArchived = yield* call("task_search", { archive: "archived" });
    assert.deepStrictEqual(
      searchedArchived.tasks.map(({ id }: { id: string }) => id),
      ["c"],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("the Tasks view archives and unarchives through the RPC and reads the history", () => {
  const { layer, rpc } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* repository.upsert(task("t"));
    const archived = yield* rpc((client) =>
      client[TASKS_RPC_METHODS.archive]({ ids: [TaskId.make("t")] }),
    );
    assert.deepStrictEqual(archived.results, [{ id: TaskId.make("t"), outcome: "archived" }]);
    yield* rpc((client) =>
      client[TASKS_RPC_METHODS.unarchive]({ ids: [TaskId.make("t")], reason: "Still needed" }),
    );
    const { events } = yield* rpc((client) =>
      client[TASKS_RPC_METHODS.events]({
        taskId: TaskId.make("t"),
        kinds: [...TASK_HISTORY_EVENT_KINDS],
      }),
    );
    assert.deepStrictEqual(
      events.map(({ kind, payload }) => ({ kind, payload })),
      [
        { kind: TASK_UNARCHIVED_EVENT, payload: { actor: person, reason: "Still needed" } },
        { kind: TASK_ARCHIVED_EVENT, payload: { actor: person } },
      ],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("every real status change records one event with its actor, from each path", () => {
  const { layer, call, rpc } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* repository.upsert(task("t"));

    // The Tasks view: a person. Choosing done is an ordinary status.
    const done = yield* rpc((client) =>
      client[TASKS_RPC_METHODS.update]({ id: TaskId.make("t"), status: "done" }),
    );
    assert.equal(done.archivedAt, null);
    // The same status again, and other fields, record nothing.
    yield* rpc((client) =>
      client[TASKS_RPC_METHODS.update]({ id: TaskId.make("t"), status: "done", title: "x" }),
    );

    // A chat agent through task_update.
    yield* call("task_update", { id: "t", status: "Review" });
    yield* call("task_update", { id: "t", output: "notes" });

    // A task-agent run, through task_update and through its task_agent_result.
    const runId = TaskAgentRunId.make("run-1");
    const runThread = ThreadId.make("thread-run-1");
    yield* repository.createAgentRun({
      id: runId,
      taskId: TaskId.make("t"),
      agentId: TaskAgentId.make("agent"),
      threadId: runThread,
      modelSelection,
      status: "running",
      startedAt: timestamp,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: null,
    });
    yield* call(
      "task_update",
      { id: "t", status: "In Progress", assigneeAgentRunId: runId },
      { ...chat, threadId: runThread },
    );
    const consume = makeTaskAgentResultConsumer({
      repository,
      scheduleTaskChanged: () => Effect.void,
    });
    yield* consume({
      threadId: runThread,
      markdown: '~~~task_agent_result\n{"status":"Needs Review","summary":"Done."}\n~~~',
      createdAt: "2026-10-07T11:00:00.000Z",
    });

    const runActor = { type: "agent-run", agentRunId: runId };
    assert.deepStrictEqual((yield* historyOf("t")).toReversed(), [
      { kind: TASK_STATUS_CHANGED_EVENT, payload: { from: "To Do", to: "done", actor: person } },
      {
        kind: TASK_STATUS_CHANGED_EVENT,
        payload: { from: "done", to: "Review", actor: { type: "thread", threadId: chatThread } },
      },
      {
        kind: TASK_STATUS_CHANGED_EVENT,
        payload: { from: "Review", to: "In Progress", actor: runActor },
      },
      {
        kind: TASK_STATUS_CHANGED_EVENT,
        payload: { from: "In Progress", to: "Needs Review", actor: runActor },
      },
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a result that keeps the status records no status event", () => {
  const { layer } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* repository.upsert(task("t", { status: "In Progress" }));
    const runThread = ThreadId.make("thread-run");
    yield* repository.createAgentRun({
      id: TaskAgentRunId.make("run"),
      taskId: TaskId.make("t"),
      agentId: TaskAgentId.make("agent"),
      threadId: runThread,
      modelSelection,
      status: "running",
      startedAt: timestamp,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: null,
    });
    yield* makeTaskAgentResultConsumer({ repository, scheduleTaskChanged: () => Effect.void })({
      threadId: runThread,
      markdown: '~~~task_agent_result\n{"status":"In Progress","summary":"Same."}\n~~~',
      createdAt: "2026-10-07T11:00:00.000Z",
    });
    assert.deepStrictEqual(yield* historyOf("t"), []);
  }).pipe(Effect.provide(layer));
});
