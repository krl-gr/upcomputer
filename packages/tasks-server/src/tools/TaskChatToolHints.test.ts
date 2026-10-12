import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { toolCallHintsFor } from "../../../../apps/server/src/provider/ToolCallHints.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { CHAT_TOOL_CALL_HINTS, TaskChatToolHintsLive } from "./TaskChatToolHints.ts";

const timestamp = "2026-10-11T10:00:00.000Z";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const TestLayer = TaskChatToolHintsLive.pipe(
  Layer.provideMerge(TaskRepositoryLive.pipe(Layer.provideMerge(database))),
);

it("derives the chat's call shapes from the task tool definitions", () => {
  // A renamed tool or argument changes this text instead of leaving a stale hint.
  assert.deepStrictEqual(
    CHAT_TOOL_CALL_HINTS.map(({ name, args }) => `${name}(${args})`),
    [
      "task_context({projectId?, workspaceRoot?, include?})",
      "task_create({projectId?, workspaceRoot?, tasks?: [{title, description, status, audience, tags?, metadata?}]})",
      "task_search({projectId?, status?, tags?, limit?})",
      "task_get({id})",
      "task_update({id, status?, output?, tags?})",
    ],
  );
});

it.layer(TestLayer)("Task tool hints", (it) => {
  it.effect("go to chats, not to task-agent run threads", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const taskId = TaskId.make("task-hints");
      yield* repository.upsert({
        id: taskId,
        projectId: ProjectId.make("project-hints"),
        title: "Hints",
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
      });
      yield* repository.upsertAgent({
        id: TaskAgentId.make("developer"),
        projectId: null,
        name: "Developer",
        enabled: true,
        startStatuses: ["To Do"],
        startTags: [],
        startRunStatuses: [],
        config: { role: "developer", modelSelection, instructions: "Work." },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const runThread = ThreadId.make("thread-run");
      yield* repository.createAgentRun({
        id: TaskAgentRunId.make("run-hints"),
        taskId,
        agentId: TaskAgentId.make("developer"),
        threadId: runThread,
        modelSelection,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        triggerRunId: null,
        continuesRunId: null,
      });

      assert.deepStrictEqual(
        yield* toolCallHintsFor(ThreadId.make("thread-chat")),
        CHAT_TOOL_CALL_HINTS,
      );
      assert.deepStrictEqual(yield* toolCallHintsFor(runThread), []);
    }),
  );
});
