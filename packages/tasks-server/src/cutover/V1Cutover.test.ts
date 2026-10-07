import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId, type Task } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import {
  TaskPromptSettingsStore,
  TaskPromptSettingsStoreLive,
} from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import {
  countTaskSystem,
  rewriteV1ToolNames,
  runTaskV1Cutover,
  V1_CUTOVER_INTERRUPT_REASON,
} from "./V1Cutover.ts";

const timestamp = "2026-10-05T10:00:00.000Z";
const cutoverAt = "2026-10-06T08:00:00.000Z";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const TestLayer = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
  Layer.provideMerge(AllChatsInstructionsLive),
  Layer.provideMerge(
    ServerSettings.layerTest({
      customInstructions: "Call mcp__upcomputer_tasks__task_context first.",
    }),
  ),
  Layer.provideMerge(database),
  Layer.provideMerge(NodeServices.layer),
);

it("rewrites V1 tool names to the names v2 serves", () => {
  const rewrite = rewriteV1ToolNames(
    "Use mcp__upcomputer_tasks__task_get, mcp__upcomputer__thread_search, " +
      "mcp__upcomputer__preview_click, the upcomputer_tasks server, project_set_linked_projects " +
      "and thread_read, but not t3_thread_read or my_thread_read_helper.",
  );
  assert.equal(
    rewrite.text,
    "Use mcp__t3-code__task_get, mcp__t3-code__t3_thread_search, " +
      "mcp__t3-code__preview_click, the t3-code server, t3_project_update " +
      "and t3_thread_read, but not t3_thread_read or my_thread_read_helper.",
  );
  assert.lengthOf(rewrite.replacements, 6);
  assert.deepStrictEqual(rewriteV1ToolNames("task_get and task_update stay.").replacements, []);
});

it.layer(TestLayer)("runTaskV1Cutover", (it) => {
  it.effect("interrupts in-flight runs and rewrites stored instructions with history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* TaskRepository;
      const instructions = yield* TaskPromptSettingsStore;
      const projectId = ProjectId.make("project-a");
      const taskId = TaskId.make("task-in-flight");
      const runId = TaskAgentRunId.make("run-in-flight");
      const agentId = TaskAgentId.make("agent-dev");
      const modelSelection = { instanceId: ProviderInstanceId.make("up"), model: "pi/default" };
      const task: Task = {
        id: taskId,
        rank: "0000000100000000" as Task["rank"],
        projectId,
        title: "Running when V1 stopped",
        description: "Read it with mcp__upcomputer__thread_read.",
        output: "Step 1 done.",
        status: "In Progress",
        priority: null,
        createdBy: "agent",
        assigneeAgentRunId: runId,
        sourceThreadId: null,
        sourceRunId: null,
        rootThreadId: null,
        parentTaskId: null,
        parentRunId: null,
        metadata: null,
        tags: ["dev"],
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
        notBefore: null,
        triggerChangedAt: timestamp,
      };
      yield* repository.upsert(task);
      yield* repository.upsertAgent({
        id: agentId,
        projectId,
        name: "Developer",
        enabled: true,
        startStatuses: ["To Do"],
        startTags: ["dev"],
        startRunStatuses: [],
        config: {
          role: "Developer",
          modelSelection,
          tools: ["read", "thread_search", "task_get"],
          instructions: "Claim with mcp__upcomputer_tasks__task_update, then task_get.",
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      yield* repository.createAgentRun({
        id: runId,
        taskId,
        agentId,
        threadId: ThreadId.make("thread-in-flight"),
        modelSelection,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        triggerRunId: null,
        continuesRunId: null,
      });
      const origin = { source: "settings-page", threadId: null, runId: null } as const;
      const global = yield* instructions.getState;
      yield* instructions.updateField({
        projectId: null,
        field: "taskExecution",
        text: "Search old chats with mcp__upcomputer__thread_search.",
        reason: "seed",
        expectedRevision: global.revision,
        origin,
        dryRun: false,
      });
      yield* instructions.updateField({
        projectId,
        field: "taskCreation",
        text: "List projects with project_list.",
        reason: "seed",
        expectedRevision: 0,
        origin,
        dryRun: false,
      });
      const before = yield* countTaskSystem;

      const report = yield* runTaskV1Cutover({ now: cutoverAt });

      assert.deepStrictEqual(report.interruptedRuns, [
        { runId, taskId, threadId: "thread-in-flight" },
      ]);
      const run = Option.getOrThrow(yield* repository.getAgentRunById({ id: runId }));
      assert.equal(run.status, "interrupted");
      assert.equal(run.completedAt, cutoverAt);
      const wake = yield* sql<{ readonly sourceWakeAt: string | null }>`
        SELECT source_wake_at AS "sourceWakeAt" FROM task_agent_runs WHERE id = ${runId}
      `;
      assert.equal(wake[0]?.sourceWakeAt, cutoverAt);
      const after = Option.getOrThrow(yield* repository.getById({ id: taskId }));
      assert.isNull(after.assigneeAgentRunId);
      assert.include(after.output ?? "", "Step 1 done.");
      assert.include(after.output ?? "", V1_CUTOVER_INTERRUPT_REASON);
      const events = yield* sql<{ readonly kind: string }>`
        SELECT kind FROM task_events WHERE task_id = ${taskId}
      `;
      assert.include(
        events.map((event) => event.kind),
        "task.agent-interrupted",
      );

      const agent = Option.getOrThrow(yield* repository.getAgentById({ id: agentId }));
      assert.equal(
        agent.config.instructions,
        "Claim with mcp__t3-code__task_update, then task_get.",
      );
      assert.deepStrictEqual(agent.config.tools, ["read", "t3_thread_search", "task_get"]);
      assert.deepStrictEqual(agent.startTags, ["dev"]);
      // A rename is not an edit that lets the agent run its finished tasks again.
      assert.equal(agent.updatedAt, timestamp);

      const state = yield* instructions.getState;
      assert.equal(state.allChats, "Call mcp__t3-code__task_context first.");
      assert.equal(
        state.settings.taskExecution,
        "Search old chats with mcp__t3-code__t3_thread_search.",
      );
      const project = yield* instructions.getProject(projectId);
      assert.equal(project.settings.taskCreation, "List projects with t3_project_list.");
      assert.deepStrictEqual(
        report.rewrittenInstructions.map((change) => `${change.projectId}:${change.field}`),
        ["null:allChats", "null:taskExecution", "project-a:taskCreation"],
      );
      const history = yield* instructions.history({ projectId: null, limit: 10 });
      assert.include(history[0]?.reason ?? "", "Cutover to v2");

      assert.deepStrictEqual(report.taskDescriptionsNamingV1Tools, [
        { taskId, title: task.title, names: ["mcp__upcomputer__thread_read"] },
      ]);
      assert.equal(
        (yield* repository.getById({ id: taskId })).pipe(Option.getOrThrow).description,
        task.description,
      );

      const counts = yield* countTaskSystem;
      assert.equal(counts.agentTriggers, before.agentTriggers);
      assert.equal(counts.runs, before.runs);
      assert.equal(counts.activeRuns, 0);
      assert.equal(counts.instructionHistory, before.instructionHistory + 3);

      // Run again: nothing left to do.
      const again = yield* runTaskV1Cutover({ now: cutoverAt });
      assert.lengthOf(again.interruptedRuns, 0);
      assert.lengthOf(again.rewrittenInstructions, 0);
      assert.lengthOf(again.rewrittenAgents, 0);
    }),
  );
});
