/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, test } from "vite-plus/test";

import {
  TaskAgentId,
  TaskAgentRunId,
  TaskEventId,
  TaskId,
  type Task,
} from "@upcomputer/tasks-contracts/v1";
import { ProjectId, ProviderInstanceId, ThreadId } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";

const directories: string[] = [];
const timestamp = "2026-09-15T10:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

test("finalization ownership and task truth commit atomically and idempotently", async () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "upcomputer-agent-finalization-"),
  );
  directories.push(directory);
  const path = NodePath.join(directory, "tasks.sqlite");
  const sql = NodeSqliteClient.layer({ filename: path });
  await Effect.runPromise(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]).pipe(Effect.provide(sql)),
  );

  const runId = TaskAgentRunId.make("run-finalization");
  const taskId = TaskId.make("task-finalization");
  const agentId = TaskAgentId.make("agent-finalization");
  const threadId = ThreadId.make("thread-finalization");
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  };
  const task: Task = {
    id: taskId,
    rank: "0000000100000000" as Task["rank"],
    projectId: ProjectId.make("project-finalization"),
    title: "Finalize safely",
    description: "",
    output: "prior output",
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
    tags: ["upcomputer-dev"],
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: null,
    notBefore: null,
    triggerChangedAt: timestamp,
  };

  await Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(task);
      yield* repository.upsertAgent({
        id: agentId,
        projectId: task.projectId,
        name: "Finalization agent",
        enabled: true,
        startStatuses: ["To Do"],
        startTags: ["upcomputer-dev"],
        config: {
          role: "Developer",
          modelSelection,
          instructions: "Test",
        },
        startRunStatuses: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      yield* repository.createAgentRun({
        id: runId,
        taskId,
        agentId,
        threadId,
        modelSelection,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        triggerRunId: null,
        continuesRunId: null,
      });

      NodeAssert.equal(
        yield* repository.claimAgentRunFinalization({
          id: runId,
          finalizingStatus: "finalizing:interrupted",
        }),
        true,
      );
      NodeAssert.equal(
        yield* repository.claimAgentRunFinalization({
          id: runId,
          finalizingStatus: "finalizing:result",
        }),
        false,
      );
      NodeAssert.equal(
        yield* repository.finalizeAgentRun({
          id: runId,
          finalizingStatus: "finalizing:result",
          status: "completed",
          completedAt: timestamp,
          taskId,
          taskStatus: "Needs Review",
          taskOutput: "losing result",
          releaseAssignment: true,
          events: [],
        }),
        false,
      );
      const unchangedTask = yield* repository.getById({ id: taskId });
      NodeAssert.equal(unchangedTask._tag, "Some");
      if (unchangedTask._tag === "Some") {
        NodeAssert.equal(unchangedTask.value.output, "prior output");
        NodeAssert.equal(unchangedTask.value.status, "In Progress");
        NodeAssert.equal(unchangedTask.value.assigneeAgentRunId, runId);
      }

      NodeAssert.equal(
        yield* repository.finalizeAgentRun({
          id: runId,
          finalizingStatus: "finalizing:interrupted",
          status: "interrupted",
          completedAt: timestamp,
          taskId,
          taskOutput: "actionable recovery",
          releaseAssignment: true,
          events: [
            {
              id: TaskEventId.make(`${runId}:interrupted`),
              taskId,
              kind: "task.agent-interrupted",
              payload: { reason: "restart" },
              createdAt: timestamp,
            },
          ],
        }),
        true,
      );
      const finalizedTask = yield* repository.getById({ id: taskId });
      const finalizedRun = yield* repository.getAgentRunById({ id: runId });
      NodeAssert.equal(finalizedTask._tag, "Some");
      NodeAssert.equal(finalizedRun._tag, "Some");
      if (finalizedTask._tag === "Some") {
        NodeAssert.equal(finalizedTask.value.status, "In Progress");
        NodeAssert.equal(finalizedTask.value.output, "actionable recovery");
        NodeAssert.equal(finalizedTask.value.assigneeAgentRunId, null);
      }
      if (finalizedRun._tag === "Some") {
        NodeAssert.equal(finalizedRun.value.status, "interrupted");
        NodeAssert.equal(finalizedRun.value.completedAt, timestamp);
      }
      NodeAssert.equal(
        yield* repository.finalizeAgentRun({
          id: runId,
          finalizingStatus: "finalizing:interrupted",
          status: "interrupted",
          completedAt: timestamp,
          taskId,
          taskOutput: "must not overwrite",
          releaseAssignment: true,
          events: [],
        }),
        false,
      );
    }).pipe(Effect.provide(TaskRepositoryLive.pipe(Layer.provide(sql)))),
  );

  const db = new NodeSqlite.DatabaseSync(path);
  NodeAssert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM task_events WHERE task_id = ?").get(taskId)?.count,
    1,
  );
  NodeAssert.equal(
    db.prepare("SELECT output FROM tasks WHERE id = ?").get(taskId)?.output,
    "actionable recovery",
  );
  db.close();
});
