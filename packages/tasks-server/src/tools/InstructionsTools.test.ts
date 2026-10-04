/* oxlint-disable t3code/no-manual-effect-runtime-in-tests -- ported V1 suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, test } from "vite-plus/test";

import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  EMPTY_TASK_PROMPT_SETTINGS,
  TASKS_RPC_METHODS,
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  TasksRpcGroup,
  type TaskPromptSettingsUpdateInput,
  type TaskPromptSettingsUpdateResult,
} from "@t3tools/tasks-contracts/v1";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ServerSettingsService,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { TaskAgentService, type TaskAgentServiceShape } from "../agents/TaskAgentService.ts";
import {
  TaskToolContextResolver,
  type TaskToolContextResolverShape,
} from "../context/TaskToolContextResolver.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TASKS_RPC_CONTRIBUTION } from "../rpc/contributions.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import { TaskToolService, TaskToolServiceLive } from "./TaskToolService.ts";
import type { TaskToolInvocationContext } from "./TaskToolTypes.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

const chat: TaskToolInvocationContext = {
  source: "provider",
  mutationPolicy: "allow",
  threadId: ThreadId.make("thread-chat"),
};
const readOnlyChat: TaskToolInvocationContext = { ...chat, mutationPolicy: "deny" };
const loopbackMcp: TaskToolInvocationContext = {
  source: "mcp",
  mutationPolicy: "allow",
};

/** The environment's active projects; any other id is unknown or deleted. */
const projectTitles: Record<string, string> = { "project-a": "Alpha", "project-b": "Beta" };

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

async function harness(options: { readonly allChats?: string } = {}) {
  // One settings service for the whole harness, so core settings persist between calls.
  const serverSettings = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ServerSettingsService;
    }).pipe(
      Effect.provide(ServerSettings.layerTest({ customInstructions: options.allChats ?? "" })),
    ),
  );
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-instructions-"));
  directories.push(directory);
  const sql = NodeSqliteClient.layer({ filename: NodePath.join(directory, "tasks.sqlite") });
  await Effect.runPromise(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]).pipe(Effect.provide(sql)),
  );
  const storage = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provideMerge(AllChatsInstructionsLive),
    Layer.provideMerge(
      Layer.mergeAll(sql, countingCrypto(), Layer.succeed(ServerSettingsService, serverSettings)),
    ),
  );
  const resolver: TaskToolContextResolverShape = {
    resolve: ({ args }) => {
      const title = args.projectId === undefined ? undefined : projectTitles[args.projectId];
      return Effect.succeed({
        projects: [],
        resolvedProject:
          title === undefined
            ? null
            : { source: "explicit-project-id", project: { id: args.projectId, title } },
      } as never);
    },
  };
  const layer = TaskToolServiceLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        storage,
        Layer.succeed(TaskToolContextResolver, resolver),
        Layer.succeed(TaskAgentService, {} as TaskAgentServiceShape),
        Layer.succeed(ThreadManagementService, {} as never),
        Layer.succeed(ProjectStoreV2, {
          getShell: (id: string) =>
            Effect.succeed(
              projectTitles[id] === undefined
                ? Option.none()
                : Option.some({ id, title: projectTitles[id] }),
            ),
        } as never),
      ),
    ),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, TaskToolService | TaskRepository>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const call = async (
    name: string,
    args: Record<string, unknown> = {},
    context: TaskToolInvocationContext = chat,
  ) => {
    const result = await run(
      Effect.flatMap(TaskToolService, (service) => service.call({ name, args, context })),
    );
    return {
      ...result,
      body: result.isError && !result.text.startsWith("{") ? null : json(result),
    };
  };
  // The settings page goes through the RPC.
  const settingsPage = (save?: TaskPromptSettingsUpdateInput, scope: { projectId?: string } = {}) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(TasksRpcGroup);
        return save
          ? yield* client[TASKS_RPC_METHODS.updatePromptSettings](save)
          : yield* client[TASKS_RPC_METHODS.getPromptSettings](scope);
      }).pipe(
        Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never })),
        Effect.provide(layer),
        Effect.scoped,
      ),
    );
  const allChats = () =>
    Effect.runPromise(
      Effect.map(serverSettings.getSettings, (settings) => settings.customInstructions),
    );
  return { call, run, settingsPage, allChats };
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
    conflicts: [],
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
  const { conflicts: _conflicts, ...savedTexts } = saved;
  NodeAssert.deepEqual(await settingsPage(), savedTexts);

  // A page edit is revertible like any other change.
  const reverted = await call("instructions_revert", { changeId: changes[1].changeId });
  NodeAssert.equal(reverted.isError, false, reverted.text);
  NodeAssert.equal(
    (await call("instructions_get")).body.fields.taskCreation.text,
    DEFAULT_TASK_PROMPT_SETTINGS.taskCreation,
  );
});

/**
 * A task with two runs: `worker`, whose agent lists no write tool, and
 * `consolidator`, whose agent lists `instructions_update`. Each run has its own thread.
 */
async function seedAgentRuns(
  run: Awaited<ReturnType<typeof harness>>["run"],
  options: { readonly ended: boolean },
) {
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
          status: options.ended ? "completed" : "running",
          startedAt: at,
          completedAt: options.ended ? at : null,
          triggerRunId: null,
          continuesRunId: null,
        });
      }
    }),
  );
}

test("task-agent runs are refused unless their agent lists the write tool; reads stay allowed", async () => {
  const { call, run } = await harness();
  await seedAgentRuns(run, { ended: false });
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

test("a thread stays restricted after its run ended; the latest run's agent decides", async () => {
  const { call, run } = await harness();
  await seedAgentRuns(run, { ended: true });
  const worker = { ...chat, threadId: ThreadId.make("thread-worker") };
  const consolidator = { ...chat, threadId: ThreadId.make("thread-consolidator") };

  const refused = await call(
    "instructions_update",
    { field: "allChats", text: "Injected rule", reason: "late turn", expectedRevision: 0 },
    worker,
  );
  NodeAssert.equal(refused.isError, true);
  NodeAssert.match(refused.text, /run-worker' cannot change the shared task instructions/);
  NodeAssert.match(refused.text, /not a security boundary/);
  NodeAssert.deepEqual((await call("instructions_history")).body.changes, []);

  const allowed = await call(
    "instructions_update",
    { field: "taskExecution", text: "Consolidated rule", reason: "weekly", expectedRevision: 0 },
    consolidator,
  );
  NodeAssert.equal(allowed.isError, false, allowed.text);
  const [change] = (await call("instructions_history")).body.changes;
  NodeAssert.equal(change.threadId, "thread-consolidator");
  NodeAssert.equal(change.runId, "run-consolidator");

  // An ordinary chat thread never used by a run may still write.
  const fromChat = await call("instructions_update", {
    field: "taskCreation",
    text: "From a chat",
    reason: "user asked",
    expectedRevision: 1,
  });
  NodeAssert.equal(fromChat.isError, false, fromChat.text);
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

test("allChats reads and writes the core customInstructions setting, with history and revert", async () => {
  const { call, allChats } = await harness({ allChats: "Answer in Russian." });

  const initial = (await call("instructions_get")).body;
  NodeAssert.equal(initial.revision, 0);
  NodeAssert.equal(initial.fields.allChats.text, "Answer in Russian.");
  NodeAssert.match(initial.fields.allChats.use, /every chat and every task-agent run/);

  const updated = await call("instructions_update", {
    field: "allChats",
    text: "  Answer in Russian.\nDelegate work to task agents.\n",
    reason: "Onboarding agreed",
    expectedRevision: 0,
  });
  NodeAssert.equal(updated.isError, false, updated.text);
  NodeAssert.equal(updated.body.revision, 1);
  // Stored trimmed, like every core settings write, and recorded as stored.
  NodeAssert.equal(await allChats(), "Answer in Russian.\nDelegate work to task agents.");
  NodeAssert.equal(
    (await call("instructions_get")).body.fields.allChats.text,
    "Answer in Russian.\nDelegate work to task agents.",
  );

  const [change] = (await call("instructions_history", { field: "allChats" })).body.changes;
  NodeAssert.deepEqual(
    {
      field: change.field,
      previousText: change.previousText,
      newText: change.newText,
      reason: change.reason,
      source: change.source,
      threadId: change.threadId,
    },
    {
      field: "allChats",
      previousText: "Answer in Russian.",
      newText: "Answer in Russian.\nDelegate work to task agents.",
      reason: "Onboarding agreed",
      source: "thread",
      threadId: "thread-chat",
    },
  );
  NodeAssert.deepEqual(
    (await call("instructions_history", { field: "taskExecution" })).body.changes,
    [],
  );

  // The same text again, differing only in surrounding whitespace, changes nothing.
  const identical = await call("instructions_update", {
    field: "allChats",
    text: "Answer in Russian.\nDelegate work to task agents.  ",
    reason: "same",
    expectedRevision: 1,
  });
  NodeAssert.equal(identical.body.changed, false);

  const reverted = await call("instructions_revert", { changeId: change.changeId });
  NodeAssert.equal(reverted.isError, false, reverted.text);
  NodeAssert.equal(reverted.body.revision, 2);
  NodeAssert.equal(await allChats(), "Answer in Russian.");

  // allChats shares the revision with the task fields.
  const stale = await call("instructions_update", {
    field: "taskCreation",
    text: "Stale",
    reason: "stale",
    expectedRevision: 1,
  });
  NodeAssert.equal(stale.isError, true);
  NodeAssert.equal(stale.body.currentRevision, 2);
});

test("allChats rejects a stale revision, dry-runs under a read-only policy, and refuses runs", async () => {
  const { call, run, allChats } = await harness();
  const first = await call("instructions_update", {
    field: "taskExecution",
    text: "Edited",
    reason: "first",
    expectedRevision: 0,
  });
  NodeAssert.equal(first.isError, false, first.text);
  const stale = await call("instructions_update", {
    field: "allChats",
    text: "From a stale chat",
    reason: "stale",
    expectedRevision: 0,
  });
  NodeAssert.equal(stale.isError, true);
  NodeAssert.equal(stale.body.currentRevision, 1);
  NodeAssert.equal(await allChats(), "");

  const preview = await call(
    "instructions_update",
    { field: "allChats", text: "Planned", reason: "plan", expectedRevision: 1 },
    readOnlyChat,
  );
  NodeAssert.equal(preview.isError, false, preview.text);
  NodeAssert.equal(preview.body.dryRun, true);
  NodeAssert.equal(preview.body.changed, true);
  NodeAssert.equal(preview.body.summary.added, "Planned");
  NodeAssert.equal(await allChats(), "");
  NodeAssert.equal(
    (await call("instructions_history", { field: "allChats" })).body.changes.length,
    0,
  );

  const tooLong = await call("instructions_update", {
    field: "allChats",
    text: "x".repeat(20_001),
    reason: "long",
    expectedRevision: 1,
  });
  NodeAssert.equal(tooLong.isError, true);
  NodeAssert.match(tooLong.text, /limited to 20000 characters/);

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
      yield* repository.upsertAgent({
        id: TaskAgentId.make("worker"),
        projectId: null,
        name: "worker",
        enabled: true,
        startStatuses: [],
        startTags: ["worker"],
        startRunStatuses: [],
        config: { role: "worker", modelSelection, instructions: "Work." },
        createdAt: at,
        updatedAt: at,
      });
      yield* repository.createAgentRun({
        id: TaskAgentRunId.make("run-worker"),
        taskId: TaskId.make("task-1"),
        agentId: TaskAgentId.make("worker"),
        threadId: ThreadId.make("thread-worker"),
        modelSelection,
        status: "running",
        startedAt: at,
        completedAt: null,
        triggerRunId: null,
        continuesRunId: null,
      });
    }),
  );
  const refused = await call(
    "instructions_update",
    { field: "allChats", text: "Injected", reason: "injected", expectedRevision: 1 },
    { ...chat, threadId: ThreadId.make("thread-worker") },
  );
  NodeAssert.equal(refused.isError, true);
  NodeAssert.match(refused.text, /run-worker' cannot change the shared task instructions/);
  NodeAssert.equal(await allChats(), "");
});

test("settings page saves of All chats go to core settings and are recorded", async () => {
  const { call, settingsPage, allChats } = await harness();
  const saved = await settingsPage({ allChats: "  Never commit without asking.\n" });
  NodeAssert.deepEqual(saved, {
    ...DEFAULT_TASK_PROMPT_SETTINGS,
    allChats: "Never commit without asking.",
    conflicts: [],
  });
  NodeAssert.equal(await allChats(), "Never commit without asking.");
  // Fields left out stay as they are, and an unchanged All chats records nothing.
  await settingsPage({ allChats: "Never commit without asking." });

  const changes = (await call("instructions_history")).body.changes;
  NodeAssert.equal(changes.length, 1);
  NodeAssert.equal(changes[0].field, "allChats");
  NodeAssert.equal(changes[0].source, "settings page");
  NodeAssert.equal(changes[0].previousText, "");

  const reverted = await call("instructions_revert", { changeId: changes[0].changeId });
  NodeAssert.equal(reverted.isError, false, reverted.text);
  NodeAssert.equal(await allChats(), "");
});

test("a settings page save does not overwrite a field a chat changed after the page loaded", async () => {
  const { call, settingsPage, allChats } = await harness({ allChats: "Loaded all chats" });
  const loaded = await settingsPage();
  const save = async (input: TaskPromptSettingsUpdateInput) =>
    (await settingsPage(input)) as TaskPromptSettingsUpdateResult;
  for (const [field, text] of [
    ["taskCreation", "Chat task guidance"],
    ["allChats", "Chat all chats"],
  ] as const) {
    const revision: number = (await call("instructions_get")).body.revision;
    const edited = await call("instructions_update", {
      field,
      text,
      reason: "chat edit",
      expectedRevision: revision,
    });
    NodeAssert.equal(edited.isError, false, edited.text);
  }

  // The page edits the same fields from its older copy: both are refused.
  const refused = await save({
    taskCreation: "Page task guidance",
    allChats: "Page all chats",
    base: { taskCreation: loaded.taskCreation, allChats: "Loaded all chats" },
  });
  NodeAssert.deepEqual(refused.conflicts, ["taskCreation", "allChats"]);
  NodeAssert.equal(refused.taskCreation, "Chat task guidance");
  NodeAssert.equal(refused.allChats, "Chat all chats");
  NodeAssert.equal(await allChats(), "Chat all chats");
  NodeAssert.equal((await call("instructions_history")).body.changes.length, 2);

  // A different field saves and keeps the chat edits.
  const saved = await save({
    taskExecution: "Page execution guidance",
    base: { taskExecution: loaded.taskExecution },
  });
  NodeAssert.deepEqual(saved, {
    ...DEFAULT_TASK_PROMPT_SETTINGS,
    taskCreation: "Chat task guidance",
    taskExecution: "Page execution guidance",
    conflicts: [],
  });
  NodeAssert.equal(await allChats(), "Chat all chats");

  // A base that matches the current text saves, e.g. after the page reloads.
  const resaved = await save({
    taskCreation: "Page task guidance",
    base: { taskCreation: "Chat task guidance" },
  });
  NodeAssert.deepEqual(resaved.conflicts, []);
  NodeAssert.equal(resaved.taskCreation, "Page task guidance");
});

test("project additions are stored, edited, listed and reverted apart from global and other projects", async () => {
  const { call } = await harness();
  const a = { projectId: "project-a" };

  const initial = await call("instructions_get", a);
  NodeAssert.equal(initial.isError, false, initial.text);
  NodeAssert.deepEqual(initial.body.project, { id: "project-a", title: "Alpha" });
  NodeAssert.equal(initial.body.revision, 0);
  NodeAssert.equal(initial.body.fields.taskCreation.text, "");
  NodeAssert.equal(initial.body.fields.allChats, undefined);
  NodeAssert.match(initial.body.fields.taskCreation.use, /added after the global text/);
  NodeAssert.deepEqual(initial.body.global.fields, DEFAULT_TASK_PROMPT_SETTINGS);

  const updated = await call("instructions_update", {
    ...a,
    field: "taskCreation",
    text: "Tag every task with release:<version>.",
    reason: "release tags",
    expectedRevision: 0,
  });
  NodeAssert.equal(updated.isError, false, updated.text);
  NodeAssert.equal(updated.body.revision, 1);
  NodeAssert.deepEqual(updated.body.project, { id: "project-a", title: "Alpha" });

  // Each scope keeps its own revision: global and project B are still at 0.
  const global = (await call("instructions_get")).body;
  NodeAssert.equal(global.revision, 0);
  NodeAssert.equal(global.fields.taskCreation.text, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
  const b = (await call("instructions_get", { projectId: "project-b" })).body;
  NodeAssert.equal(b.revision, 0);
  NodeAssert.equal(b.fields.taskCreation.text, "");
  const globalEdit = await call("instructions_update", {
    field: "taskExecution",
    text: "Global rule",
    reason: "global",
    expectedRevision: 0,
  });
  NodeAssert.equal(globalEdit.isError, false, globalEdit.text);
  NodeAssert.equal(globalEdit.body.revision, 1);

  const stale = await call("instructions_update", {
    ...a,
    field: "agentCreation",
    text: "Stale",
    reason: "stale",
    expectedRevision: 0,
  });
  NodeAssert.equal(stale.isError, true);
  NodeAssert.equal(stale.body.currentRevision, 1);

  const history = (await call("instructions_history", a)).body.changes;
  NodeAssert.deepEqual(
    history.map(({ projectId, revision, field }: Record<string, unknown>) => ({
      projectId,
      revision,
      field,
    })),
    [{ projectId: "project-a", revision: 1, field: "taskCreation" }],
  );
  const globalHistory = (await call("instructions_history")).body.changes;
  NodeAssert.deepEqual(
    globalHistory.map(({ field }: Record<string, unknown>) => field),
    ["taskExecution"],
  );
  NodeAssert.equal(globalHistory[0].projectId, undefined);
  NodeAssert.deepEqual(
    (await call("instructions_history", { projectId: "project-b" })).body.changes,
    [],
  );

  // A change is reverted in its own scope only.
  const elsewhere = await call("instructions_revert", { changeId: history[0].changeId });
  NodeAssert.equal(elsewhere.isError, true);
  NodeAssert.match(elsewhere.text, /not found in the global instructions/);
  const reverted = await call("instructions_revert", { ...a, changeId: history[0].changeId });
  NodeAssert.equal(reverted.isError, false, reverted.text);
  NodeAssert.equal(reverted.body.revision, 2);
  NodeAssert.equal((await call("instructions_get", a)).body.fields.taskCreation.text, "");
  NodeAssert.equal((await call("instructions_get")).body.fields.taskExecution.text, "Global rule");
});

test("project scope refuses allChats and unknown projects", async () => {
  const { call } = await harness({ allChats: "Every chat" });
  for (const [name, args] of [
    [
      "instructions_update",
      {
        projectId: "project-a",
        field: "allChats",
        text: "Project chats",
        reason: "no",
        expectedRevision: 0,
      },
    ],
    ["instructions_history", { projectId: "project-a", field: "allChats" }],
  ] as const) {
    const refused = await call(name, args);
    NodeAssert.equal(refused.isError, true);
    NodeAssert.match(refused.text, /allChats is global/);
  }
  for (const [name, args] of [
    ["instructions_get", { projectId: "project-deleted" }],
    [
      "instructions_update",
      {
        projectId: "project-deleted",
        field: "taskCreation",
        text: "x",
        reason: "no",
        expectedRevision: 0,
      },
    ],
    ["instructions_history", { projectId: "project-deleted" }],
    ["instructions_revert", { projectId: "project-deleted", changeId: "missing" }],
  ] as const) {
    const refused = await call(name, args);
    NodeAssert.equal(refused.isError, true);
    NodeAssert.match(refused.text, /Project 'project-deleted' was not found/);
  }
  NodeAssert.equal((await call("instructions_get")).body.revision, 0);
});

test("task_context gives the global guidance plus the target project's additions only", async () => {
  const { call } = await harness();
  for (const [projectId, text] of [
    ["project-a", "Alpha creation rule"],
    ["project-b", "Beta creation rule"],
  ] as const) {
    const updated = await call("instructions_update", {
      projectId,
      field: "taskCreation",
      text,
      reason: "project rule",
      expectedRevision: 0,
    });
    NodeAssert.equal(updated.isError, false, updated.text);
  }

  const forA = (await call("task_context", { projectId: "project-a" })).body.promptGuidance;
  NodeAssert.deepEqual(forA, {
    ...DEFAULT_TASK_PROMPT_SETTINGS,
    taskCreation: `${DEFAULT_TASK_PROMPT_SETTINGS.taskCreation}\n\nProject "Alpha":\nAlpha creation rule`,
  });
  NodeAssert.ok(!JSON.stringify(forA).includes("Beta creation rule"));
  // Without a resolved project, only the global texts.
  NodeAssert.deepEqual(
    (await call("task_context")).body.promptGuidance,
    DEFAULT_TASK_PROMPT_SETTINGS,
  );
});

test("project writes keep the run restriction and dry runs", async () => {
  const { call, run } = await harness();
  await seedAgentRuns(run, { ended: false });
  const worker = { ...chat, threadId: ThreadId.make("thread-worker") };
  const write = {
    projectId: "project-a",
    field: "taskExecution",
    text: "Injected project rule",
    reason: "injected",
    expectedRevision: 0,
  };

  const refused = await call("instructions_update", write, worker);
  NodeAssert.equal(refused.isError, true);
  NodeAssert.match(refused.text, /run-worker' cannot change the shared task instructions/);

  const preview = await call("instructions_update", write, readOnlyChat);
  NodeAssert.equal(preview.isError, false, preview.text);
  NodeAssert.equal(preview.body.dryRun, true);
  NodeAssert.equal(preview.body.changed, true);

  const real = await call("instructions_update", write);
  NodeAssert.equal(real.isError, false, real.text);
  const revertPreview = await call(
    "instructions_revert",
    { projectId: "project-a", changeId: real.body.changeId },
    readOnlyChat,
  );
  NodeAssert.equal(revertPreview.isError, false, revertPreview.text);
  NodeAssert.equal(revertPreview.body.dryRun, true);
  const revertRefused = await call(
    "instructions_revert",
    { projectId: "project-a", changeId: real.body.changeId },
    worker,
  );
  NodeAssert.equal(revertRefused.isError, true);

  const state = (await call("instructions_get", { projectId: "project-a" })).body;
  NodeAssert.equal(state.revision, 1);
  NodeAssert.equal(state.fields.taskExecution.text, "Injected project rule");
  NodeAssert.equal(
    (await call("instructions_history", { projectId: "project-a" })).body.changes.length,
    1,
  );
});

test("settings page saves a project's additions with per-scope conflicts and no allChats", async () => {
  const { call, settingsPage, allChats } = await harness({ allChats: "Every chat" });
  const save = async (input: TaskPromptSettingsUpdateInput) =>
    (await settingsPage(input)) as TaskPromptSettingsUpdateResult;

  NodeAssert.deepEqual(
    await settingsPage(undefined, { projectId: "project-a" }),
    EMPTY_TASK_PROMPT_SETTINGS,
  );
  const saved = await save({
    projectId: "project-a",
    taskCreation: "Page rule",
    base: { taskCreation: "" },
  });
  NodeAssert.deepEqual(saved, {
    ...EMPTY_TASK_PROMPT_SETTINGS,
    taskCreation: "Page rule",
    conflicts: [],
  });
  NodeAssert.deepEqual(await settingsPage(), DEFAULT_TASK_PROMPT_SETTINGS);
  NodeAssert.deepEqual(
    await settingsPage(undefined, { projectId: "project-b" }),
    EMPTY_TASK_PROMPT_SETTINGS,
  );

  // A chat edits the project field after the page loaded it: the page save is refused.
  const chatEdit = await call("instructions_update", {
    projectId: "project-a",
    field: "taskCreation",
    text: "Chat rule",
    reason: "chat",
    expectedRevision: 1,
  });
  NodeAssert.equal(chatEdit.isError, false, chatEdit.text);
  const refused = await save({
    projectId: "project-a",
    taskCreation: "Page rule 2",
    base: { taskCreation: "Page rule" },
  });
  NodeAssert.deepEqual(refused.conflicts, ["taskCreation"]);
  NodeAssert.equal(refused.taskCreation, "Chat rule");

  // The same base is current for the global field, which saves.
  const globalSave = await save({
    taskCreation: "Global page rule",
    base: { taskCreation: DEFAULT_TASK_PROMPT_SETTINGS.taskCreation },
  });
  NodeAssert.deepEqual(globalSave.conflicts, []);

  await NodeAssert.rejects(
    save({ projectId: "project-a", allChats: "Project chats", base: { allChats: "Every chat" } }),
    /All chats is global/,
  );
  NodeAssert.equal(await allChats(), "Every chat");
});
