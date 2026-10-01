/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, test } from "vite-plus/test";

import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  TASKS_RPC_METHODS,
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  TasksRpcGroup,
  type TaskPromptSettings,
} from "@upcomputer/tasks-contracts/v1";
import { ProjectId, ProviderInstanceId, ThreadId } from "@upcomputer/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import {
  ProjectionSnapshotQuery,
  runExperimentalFeatureMigrations,
  type ExperimentalDynamicToolInvocationContext,
} from "../../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { TaskAgentService, type TaskAgentServiceShape } from "../agents/TaskAgentService.ts";
import {
  TaskToolContextResolver,
  type TaskToolContextResolverShape,
} from "../context/TaskToolContextResolver.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TASKS_RPC_CONTRIBUTION } from "../rpc/contributions.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import { TaskToolService, TaskToolServiceLive } from "./TaskToolService.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

const chat: ExperimentalDynamicToolInvocationContext = {
  source: "provider",
  mutationPolicy: "allow",
  threadId: ThreadId.make("thread-chat"),
};
const readOnlyChat: ExperimentalDynamicToolInvocationContext = { ...chat, mutationPolicy: "deny" };
const loopbackMcp: ExperimentalDynamicToolInvocationContext = {
  source: "mcp",
  mutationPolicy: "allow",
};

function countingCrypto(): Layer.Layer<Crypto.Crypto> {
  let seed = 0;
  return Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => {
        seed += 1;
        return Uint8Array.from({ length: size }, (_, index) => (seed * 31 + index) % 256);
      },
      digest: () => Effect.die("unused digest"),
    }),
  );
}

async function harness() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-instructions-"));
  directories.push(directory);
  const sql = NodeSqliteClient.layer({ filename: NodePath.join(directory, "tasks.sqlite") });
  await Effect.runPromise(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]).pipe(Effect.provide(sql)),
  );
  const storage = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provideMerge(Layer.merge(sql, countingCrypto())),
  );
  const resolver: TaskToolContextResolverShape = {
    resolve: () => Effect.succeed({ projects: [] } as never),
  };
  const layer = TaskToolServiceLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        storage,
        Layer.succeed(TaskToolContextResolver, resolver),
        Layer.succeed(TaskAgentService, {} as TaskAgentServiceShape),
        Layer.succeed(ProjectionSnapshotQuery, {} as never),
      ),
    ),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, TaskToolService | TaskRepository>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const call = async (
    name: string,
    args: Record<string, unknown> = {},
    context: ExperimentalDynamicToolInvocationContext = chat,
  ) => {
    const result = await run(
      Effect.flatMap(TaskToolService, (service) => service.call({ name, args, context })),
    );
    return {
      ...result,
      body: result.isError && !result.text.startsWith("{") ? null : json(result),
    };
  };
  // The settings page goes through the unchanged RPC.
  const settingsPage = (save?: TaskPromptSettings) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(TasksRpcGroup);
        return save
          ? yield* client[TASKS_RPC_METHODS.updatePromptSettings](save)
          : yield* client[TASKS_RPC_METHODS.getPromptSettings]({});
      }).pipe(
        Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never })),
        Effect.provide(layer),
        Effect.scoped,
      ),
    );
  return { call, run, settingsPage };
}

function json(result: { readonly text: string }) {
  return JSON.parse(result.text);
}

test("instructions tools are served with read and write classifications", () => {
  const mutations = Object.fromEntries(
    TASK_TOOL_SPECS.filter(({ name }) => name.startsWith("instructions_")).map((spec) => [
      spec.name,
      spec.mutation,
    ]),
  );
  NodeAssert.deepEqual(mutations, {
    instructions_get: "read",
    instructions_update: "write",
    instructions_history: "read",
    instructions_revert: "write",
  });
});

test("update, history and revert round-trip with a new change per edit", async () => {
  const { call } = await harness();

  const initial = await call("instructions_get");
  NodeAssert.equal(initial.isError, false, initial.text);
  NodeAssert.equal(initial.body.revision, 0);
  NodeAssert.equal(
    initial.body.fields.taskExecution.text,
    DEFAULT_TASK_PROMPT_SETTINGS.taskExecution,
  );
  NodeAssert.equal(
    initial.body.fields.taskExecution.length,
    DEFAULT_TASK_PROMPT_SETTINGS.taskExecution.length,
  );
  NodeAssert.equal(initial.body.triggerRules.editable, false);
  NodeAssert.ok(initial.body.triggerRules.rules.length > 0);

  const edited = `${DEFAULT_TASK_PROMPT_SETTINGS.taskExecution}\nRun the focused tests before handing off.`;
  const updated = await call("instructions_update", {
    field: "taskExecution",
    text: edited,
    reason: "User asked for focused tests",
    expectedRevision: 0,
  });
  NodeAssert.equal(updated.isError, false, updated.text);
  NodeAssert.equal(updated.body.revision, 1);
  NodeAssert.equal(updated.body.changed, true);
  NodeAssert.equal(updated.body.summary.added, "\nRun the focused tests before handing off.");
  NodeAssert.equal(updated.body.summary.removed, "");
  const changeId: string = updated.body.changeId;

  const history = await call("instructions_history", {});
  NodeAssert.deepEqual(
    history.body.changes.map(
      ({ createdAt: _createdAt, ...change }: Record<string, unknown>) => change,
    ),
    [
      {
        changeId,
        revision: 1,
        field: "taskExecution",
        previousText: DEFAULT_TASK_PROMPT_SETTINGS.taskExecution,
        newText: edited,
        reason: "User asked for focused tests",
        source: "thread",
        threadId: "thread-chat",
        runId: null,
        revertsChangeId: null,
      },
    ],
  );

  const reverted = await call("instructions_revert", { changeId });
  NodeAssert.equal(reverted.isError, false, reverted.text);
  NodeAssert.equal(reverted.body.revision, 2);
  NodeAssert.equal(reverted.body.revertedChangeId, changeId);
  NodeAssert.equal(
    (await call("instructions_get")).body.fields.taskExecution.text,
    DEFAULT_TASK_PROMPT_SETTINGS.taskExecution,
  );

  const again = await call("instructions_revert", { changeId });
  NodeAssert.equal(again.isError, false, again.text);
  NodeAssert.equal(again.body.changed, false);
  NodeAssert.equal(again.body.revision, 2);

  // A revert is itself a change and can be undone.
  const redo = await call("instructions_revert", {
    changeId: reverted.body.changeId,
    reason: "Keep the rule after all",
  });
  NodeAssert.equal(redo.isError, false, redo.text);
  NodeAssert.equal((await call("instructions_get")).body.fields.taskExecution.text, edited);

  const all = (await call("instructions_history", { field: "taskExecution" })).body.changes;
  NodeAssert.deepEqual(
    all.map(({ revision, revertsChangeId, reason }: Record<string, unknown>) => ({
      revision,
      revertsChangeId,
      reason,
    })),
    [
      { revision: 3, revertsChangeId: reverted.body.changeId, reason: "Keep the rule after all" },
      { revision: 2, revertsChangeId: changeId, reason: `Revert ${changeId}` },
      { revision: 1, revertsChangeId: null, reason: "User asked for focused tests" },
    ],
  );
  NodeAssert.deepEqual(
    (await call("instructions_history", { field: "taskCreation" })).body.changes,
    [],
  );
  NodeAssert.equal((await call("instructions_history", { limit: 1 })).body.changes.length, 1);
});

test("a stale expectedRevision is rejected and writes nothing", async () => {
  const { call } = await harness();
  const first = await call("instructions_update", {
    field: "taskCreation",
    text: "First chat",
    reason: "first",
    expectedRevision: 0,
  });
  NodeAssert.equal(first.isError, false, first.text);

  const second = await call("instructions_update", {
    field: "agentCreation",
    text: "Second chat",
    reason: "second",
    expectedRevision: 0,
  });
  NodeAssert.equal(second.isError, true);
  NodeAssert.match(second.body.error, /instructions_get again/);
  NodeAssert.equal(second.body.currentRevision, 1);

  const state = (await call("instructions_get")).body;
  NodeAssert.equal(state.revision, 1);
  NodeAssert.equal(state.fields.taskCreation.text, "First chat");
  NodeAssert.equal(state.fields.agentCreation.text, DEFAULT_TASK_PROMPT_SETTINGS.agentCreation);
  NodeAssert.equal((await call("instructions_history")).body.changes.length, 1);

  const identical = await call("instructions_update", {
    field: "taskCreation",
    text: "First chat",
    reason: "same",
    expectedRevision: 1,
  });
  NodeAssert.equal(identical.body.changed, false);
  NodeAssert.equal(identical.body.revision, 1);
});

test("settings page saves are recorded per changed field with the RPC payload unchanged", async () => {
  const { call, settingsPage } = await harness();
  const saved = await settingsPage({
    ...DEFAULT_TASK_PROMPT_SETTINGS,
    taskCreation: "Page task guidance",
    taskExecution: "Page execution guidance",
  });
  NodeAssert.deepEqual(saved, {
    ...DEFAULT_TASK_PROMPT_SETTINGS,
    taskCreation: "Page task guidance",
    taskExecution: "Page execution guidance",
  });
  // Saving the same texts again records nothing.
  await settingsPage(saved);

  const changes = (await call("instructions_history")).body.changes;
  NodeAssert.deepEqual(
    changes.map(
      ({ revision, field, source, threadId, runId, reason }: Record<string, unknown>) => ({
        revision,
        field,
        source,
        threadId,
        runId,
        reason,
      }),
    ),
    [
      {
        revision: 2,
        field: "taskExecution",
        source: "settings page",
        threadId: null,
        runId: null,
        reason: null,
      },
      {
        revision: 1,
        field: "taskCreation",
        source: "settings page",
        threadId: null,
        runId: null,
        reason: null,
      },
    ],
  );
  NodeAssert.equal((await call("instructions_get")).body.revision, 2);
  NodeAssert.deepEqual(await settingsPage(), saved);

  // A page edit is revertible like any other change.
  const reverted = await call("instructions_revert", { changeId: changes[1].changeId });
  NodeAssert.equal(reverted.isError, false, reverted.text);
  NodeAssert.equal(
    (await call("instructions_get")).body.fields.taskCreation.text,
    DEFAULT_TASK_PROMPT_SETTINGS.taskCreation,
  );
});

test("task-agent runs are refused unless their agent lists the write tool; reads stay allowed", async () => {
  const { call, run } = await harness();
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
  const at = new Date().toISOString();
  await run(
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert({
        id: TaskId.make("task-1"),
        projectId: ProjectId.make("project-1"),
        title: "Task",
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
      });
      for (const [id, tools] of [
        ["worker", undefined],
        ["consolidator", ["instructions_update"]],
      ] as const) {
        yield* repository.upsertAgent({
          id: TaskAgentId.make(id),
          projectId: null,
          name: id,
          enabled: true,
          startStatuses: [],
          startTags: [id],
          startRunStatuses: [],
          config: {
            role: id,
            modelSelection,
            instructions: "Work.",
            ...(tools ? { tools } : {}),
          },
          createdAt: at,
          updatedAt: at,
        });
        yield* repository.createAgentRun({
          id: TaskAgentRunId.make(`run-${id}`),
          taskId: TaskId.make("task-1"),
          agentId: TaskAgentId.make(id),
          threadId: ThreadId.make(`thread-${id}`),
          modelSelection,
          status: "running",
          startedAt: at,
          completedAt: null,
          triggerRunId: null,
          continuesRunId: null,
        });
      }
    }),
  );
  const worker = { ...chat, threadId: ThreadId.make("thread-worker") };
  const consolidator = { ...chat, threadId: ThreadId.make("thread-consolidator") };

  const refused = await call(
    "instructions_update",
    { field: "taskExecution", text: "Injected rule", reason: "injected", expectedRevision: 0 },
    worker,
  );
  NodeAssert.equal(refused.isError, true);
  NodeAssert.match(refused.text, /run-worker' cannot change the shared task instructions/);
  NodeAssert.equal((await call("instructions_get", {}, worker)).body.revision, 0);
  NodeAssert.deepEqual((await call("instructions_history", {}, worker)).body.changes, []);

  const allowed = await call(
    "instructions_update",
    { field: "taskExecution", text: "Consolidated rule", reason: "weekly", expectedRevision: 0 },
    consolidator,
  );
  NodeAssert.equal(allowed.isError, false, allowed.text);
  const [change] = (await call("instructions_history")).body.changes;
  NodeAssert.equal(change.threadId, "thread-consolidator");
  NodeAssert.equal(change.runId, "run-consolidator");

  // The consolidator lists only instructions_update, so it cannot revert.
  const revert = await call("instructions_revert", { changeId: change.changeId }, consolidator);
  NodeAssert.equal(revert.isError, true);
  NodeAssert.match(revert.text, /adding 'instructions_revert' to its tools/);
});

test("a read-only mutation policy dry-runs writes without recording anything", async () => {
  const { call } = await harness();
  const preview = await call(
    "instructions_update",
    { field: "automationCreation", text: "Planned text", reason: "plan", expectedRevision: 0 },
    readOnlyChat,
  );
  NodeAssert.equal(preview.isError, false, preview.text);
  NodeAssert.equal(preview.body.dryRun, true);
  NodeAssert.equal(preview.body.changed, true);
  NodeAssert.equal(preview.body.revision, 0);
  NodeAssert.equal(preview.body.changeId, undefined);
  NodeAssert.equal(preview.body.summary.added, "Planned text");

  const stale = await call(
    "instructions_update",
    { field: "automationCreation", text: "Planned text", reason: "plan", expectedRevision: 3 },
    readOnlyChat,
  );
  NodeAssert.equal(stale.isError, true);

  const real = await call("instructions_update", {
    field: "automationCreation",
    text: "Real text",
    reason: "real",
    expectedRevision: 0,
  });
  const revertPreview = await call(
    "instructions_revert",
    { changeId: real.body.changeId },
    readOnlyChat,
  );
  NodeAssert.equal(revertPreview.isError, false, revertPreview.text);
  NodeAssert.equal(revertPreview.body.dryRun, true);

  const state = (await call("instructions_get")).body;
  NodeAssert.equal(state.revision, 1);
  NodeAssert.equal(state.fields.automationCreation.text, "Real text");
  NodeAssert.equal((await call("instructions_history")).body.changes.length, 1);
});

test("the loopback MCP bridge may write and is recorded as an MCP client", async () => {
  const { call } = await harness();
  const updated = await call(
    "instructions_update",
    { field: "agentCreation", text: "From an external client", reason: "mcp", expectedRevision: 0 },
    loopbackMcp,
  );
  NodeAssert.equal(updated.isError, false, updated.text);
  const [change] = (await call("instructions_history")).body.changes;
  NodeAssert.equal(change.source, "MCP client");
  NodeAssert.equal(change.threadId, null);
});

test("revert refuses to undo later edits of the same field", async () => {
  const { call } = await harness();
  const first = await call("instructions_update", {
    field: "taskExecution",
    text: "One",
    reason: "first",
    expectedRevision: 0,
  });
  const second = await call("instructions_update", {
    field: "taskExecution",
    text: "Two",
    reason: "second",
    expectedRevision: 1,
  });
  const refused = await call("instructions_revert", { changeId: first.body.changeId });
  NodeAssert.equal(refused.isError, true);
  NodeAssert.deepEqual(
    refused.body.laterChanges.map(({ changeId }: { changeId: string }) => changeId),
    [second.body.changeId],
  );
  NodeAssert.equal((await call("instructions_get")).body.fields.taskExecution.text, "Two");

  // Newest first works.
  NodeAssert.equal(
    (await call("instructions_revert", { changeId: second.body.changeId })).isError,
    false,
  );
  NodeAssert.equal(
    (await call("instructions_revert", { changeId: first.body.changeId })).isError,
    false,
  );
  NodeAssert.equal(
    (await call("instructions_get")).body.fields.taskExecution.text,
    DEFAULT_TASK_PROMPT_SETTINGS.taskExecution,
  );
});

test("instructions tools validate their input", async () => {
  const { call } = await harness();
  const invalid: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["instructions_update", { field: "bogus", text: "x", reason: "r", expectedRevision: 0 }],
    ["instructions_update", { field: "taskCreation", text: "x", expectedRevision: 0 }],
    ["instructions_update", { field: "taskCreation", text: "x", reason: " ", expectedRevision: 0 }],
    [
      "instructions_update",
      { field: "taskCreation", text: "x", reason: "r", expectedRevision: -1 },
    ],
    ["instructions_update", { field: "taskCreation", text: "x", reason: "r" }],
    ["instructions_history", { limit: 0 }],
    ["instructions_history", { limit: 101 }],
    ["instructions_history", { field: "triggerRules" }],
    ["instructions_revert", {}],
  ];
  for (const [name, args] of invalid) {
    const result = await call(name, args);
    NodeAssert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
  }
  const missing = await call("instructions_revert", { changeId: "missing" });
  NodeAssert.equal(missing.isError, true);
  NodeAssert.match(missing.text, /'missing' was not found/);
  NodeAssert.equal((await call("instructions_get")).body.revision, 0);
});

test("task_context points at the instructions tools", async () => {
  const { call } = await harness();
  const context = await call("task_context");
  NodeAssert.equal(context.isError, false, context.text);
  NodeAssert.match(context.body.promptGuidanceEditing, /instructions_update/);
  NodeAssert.deepEqual(context.body.promptGuidance, DEFAULT_TASK_PROMPT_SETTINGS);
});

test("a large taskExecution update carries a size warning", async () => {
  const { call } = await harness();
  const updated = await call("instructions_update", {
    field: "taskExecution",
    text: "x".repeat(2_500),
    reason: "large",
    expectedRevision: 0,
  });
  NodeAssert.match(updated.body.summary.warning, /2500 characters/);
  NodeAssert.ok(updated.body.summary.added.length < 700);
});
