import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  LEGACY_TASK_PROMPT_SETTINGS,
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { BotService } from "../bots/BotService.ts";
import { TaskToolContextResolver } from "../context/TaskToolContextResolver.ts";
import { InboxProject } from "../inbox/InboxProject.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleService } from "../schedule/TaskScheduleService.ts";
import { TASK_TOOL_SPECS } from "../tools/TaskToolDefinitions.ts";
import { TaskToolService, TaskToolServiceLive } from "../tools/TaskToolService.ts";
import type { TaskToolInvocationContext } from "../tools/TaskToolTypes.ts";
import { INSTRUCTION_UPDATE_TOOL_NAMES } from "./InstructionUpdateTools.ts";
import { InstructionUpdatesServiceLive } from "./InstructionUpdatesService.ts";

const timestamp = "2026-11-20T10:00:00.000Z";
const project = ProjectId.make("project-1");
const ENTRY = "task-statuses-v2";
const penny: TaskToolInvocationContext = {
  source: "provider",
  mutationPolicy: "allow",
  threadId: ThreadId.make("thread-penny"),
};
const planMode: TaskToolInvocationContext = { ...penny, mutationPolicy: "deny" };
/** A task-agent run's thread; its agent lists no tools. */
const agentRun: TaskToolInvocationContext = { ...penny, threadId: ThreadId.make("thread-run") };

const layer = TaskToolServiceLive.pipe(
  Layer.provideMerge(InstructionUpdatesServiceLive),
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.succeed(TaskToolContextResolver, {} as never),
      Layer.succeed(TaskAgentService, { scheduleAgentChanged: () => Effect.void } as never),
      Layer.succeed(ThreadManagementService, {} as never),
      Layer.succeed(TaskScheduleService, {} as never),
      Layer.succeed(BotService, {
        forThread: (threadId: string) =>
          Effect.succeed(threadId === "thread-penny" ? { agent: { name: "Penny" } } : null),
      } as never),
      Layer.succeed(InboxProject, {} as never),
      Layer.succeed(ProjectStoreV2, {} as never),
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
      Layer.provideMerge(AllChatsInstructionsLive),
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])).pipe(
            Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
          ),
          NodeServices.layer,
          NodeCrypto.layer,
          ServerSettings.layerTest({ customInstructions: "" }),
        ),
      ),
    ),
  ),
);

const call = (name: string, args: Record<string, unknown>, context = penny) =>
  Effect.flatMap(TaskToolService, (tools) => tools.call({ name, args, context }));

const ok = (name: string, args: Record<string, unknown>, context = penny) =>
  call(name, args, context).pipe(
    Effect.map((result) => {
      assert.equal(result.isError, false, result.text);
      return JSON.parse(result.text);
    }),
  );

/** An install from before this build: workflow 1, its texts, the update pending, and tasks. */
const existingInstall = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE task_settings SET workflow_version = 1`;
  yield* sql`UPDATE task_prompt_settings SET
    task_creation = ${LEGACY_TASK_PROMPT_SETTINGS.taskCreation},
    agent_creation = ${LEGACY_TASK_PROMPT_SETTINGS.agentCreation},
    task_execution = ${LEGACY_TASK_PROMPT_SETTINGS.taskExecution}`;
  yield* sql`UPDATE task_instruction_updates SET state = 'pending'`;
  const repository = yield* TaskRepository;
  for (const [id, status] of [
    ["queued-1", "Backlog"],
    ["queued-2", "Backlog"],
    ["question", "Needs Input"],
  ] as const)
    yield* repository.upsert({
      id: TaskId.make(id),
      projectId: project,
      title: id,
      description: "",
      output: null,
      status,
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
    });
  const agentId = TaskAgentId.make("agent-dev");
  yield* repository.upsertAgent({
    id: agentId,
    projectId: null,
    name: "Dev",
    enabled: false,
    startStatuses: ["To Do"],
    startTags: [],
    startRunStatuses: [],
    config: {
      role: "developer",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-test" },
      instructions: "Build it.",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  });
  yield* repository.createAgentRun({
    id: TaskAgentRunId.make("run-1"),
    taskId: TaskId.make("question"),
    agentId,
    threadId: ThreadId.make("thread-run"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-test" },
    status: "completed",
    startedAt: timestamp,
    completedAt: timestamp,
    triggerRunId: null,
    continuesRunId: null,
  });
});

const statusOf = (id: string) =>
  Effect.flatMap(TaskRepository, (repository) => repository.getById({ id: TaskId.make(id) })).pipe(
    Effect.map((task) => Option.getOrThrow(task).status),
  );

it("the update tools are served, get as a read and the rest as writes", () => {
  const mutations = Object.fromEntries(
    TASK_TOOL_SPECS.filter(({ name }) =>
      (INSTRUCTION_UPDATE_TOOL_NAMES as ReadonlyArray<string>).includes(name),
    ).map((spec) => [spec.name, spec.mutation]),
  );
  assert.deepStrictEqual(mutations, {
    instruction_updates_get: "read",
    instruction_update_decide: "write",
    task_status_rename: "write",
    task_list_settings_update: "write",
    task_workflow_version_set: "write",
  });
});

describe("instruction update tools", () => {
  it.effect(
    "a bot reads the update and its brief, renames in bulk, reorders, switches and closes it",
    () =>
      Effect.gen(function* () {
        yield* existingInstall;
        const read = yield* ok("instruction_updates_get", {});
        assert.strictEqual(read.workflowVersion, 1);
        assert.deepInclude(read.entries[0], { id: ENTRY, state: "pending", editedFields: [] });
        assert.notProperty(read, "brief");
        const withBrief = yield* ok("instruction_updates_get", { id: ENTRY });
        assert.include(withBrief.brief, "Change nothing until the user agrees");
        assert.isTrue((yield* call("instruction_updates_get", { id: "nope" })).isError);

        const renamed = yield* ok("task_status_rename", { from: "Backlog", to: "Queued" });
        assert.strictEqual(renamed.renamed, 2);
        assert.sameMembers(renamed.ids, ["queued-1", "queued-2"]);
        assert.include(renamed.undo, 'from "Queued" to "Backlog"');
        assert.strictEqual(yield* statusOf("queued-1"), "Queued");

        const order = yield* ok("task_list_settings_update", {
          statusGroupOrder: ["needs you", "queued"],
        });
        assert.deepStrictEqual(order.previous.statusGroupOrder, []);
        assert.deepStrictEqual(order.current.statusGroupOrder, ["needs you", "queued"]);

        const early = yield* call("instruction_update_decide", { id: ENTRY, state: "applied" });
        assert.isTrue(early.isError);
        assert.include(early.text, "task_workflow_version_set with version 2");

        assert.deepStrictEqual(yield* ok("task_workflow_version_set", { version: 2 }), {
          previous: 1,
          version: 2,
        });

        const decided = yield* ok("instruction_update_decide", { id: ENTRY, state: "applied" });
        assert.strictEqual(decided.state, "applied");
        assert.deepStrictEqual(decided.decidedBy, { kind: "chat", name: "Penny" });
        const after = yield* ok("instruction_updates_get", {});
        assert.strictEqual(after.workflowVersion, 2);
        assert.deepStrictEqual(after.statusGroupOrder, ["needs you", "queued"]);
        assert.strictEqual(after.entries[0].state, "applied");
      }).pipe(Effect.provide(layer)),
  );

  it.effect("plan mode previews and changes nothing; a task-agent run is refused", () =>
    Effect.gen(function* () {
      yield* existingInstall;
      const preview = yield* ok(
        "task_status_rename",
        { from: "Needs Input", to: "Needs You" },
        planMode,
      );
      assert.strictEqual(preview.dryRun, true);
      assert.strictEqual(preview.renamed, 1);
      assert.strictEqual(yield* statusOf("question"), "Needs Input");
      const version = yield* ok("task_workflow_version_set", { version: 2 }, planMode);
      assert.strictEqual(version.dryRun, true);
      assert.strictEqual((yield* ok("instruction_updates_get", {})).workflowVersion, 1);

      for (const [name, args] of [
        ["task_status_rename", { from: "Needs Input", to: "Needs You" }],
        ["task_list_settings_update", { statusGroupOrder: [] }],
        ["task_workflow_version_set", { version: 2 }],
        ["instruction_update_decide", { id: ENTRY, state: "kept" }],
      ] as const) {
        const refused = yield* call(name, args, agentRun);
        assert.isTrue(refused.isError, name);
        assert.include(refused.text, `adding '${name}' to its tools`);
      }
      assert.strictEqual(yield* statusOf("question"), "Needs Input");
    }).pipe(Effect.provide(layer)),
  );
});
