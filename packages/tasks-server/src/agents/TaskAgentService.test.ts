/* oxlint-disable t3code/no-manual-effect-runtime-in-tests -- ported V1 suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { test } from "vite-plus/test";

import {
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
} from "@t3tools/tasks-contracts/v1";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import type { ThreadManagementSendInput } from "../../../../apps/server/src/orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  TaskPromptSettingsStoreLive,
} from "../persistence/TaskPromptSettingsStore.ts";
import {
  continuesTaskAgentRun,
  releasedRunId,
  runsAgain,
  TaskAgentService,
  TaskAgentServiceLive,
} from "./TaskAgentService.ts";

const now = "2026-08-04T11:11:22.000Z";
const runId = TaskAgentRunId.make("run-1");

function agent(overrides: Partial<TaskAgent> = {}): TaskAgent {
  return {
    id: TaskAgentId.make("agent-1"),
    projectId: ProjectId.make("project-1"),
    name: "Test agent",
    enabled: true,
    startStatuses: ["new"],
    startTags: ["test"],
    config: {
      role: "Test agent",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      instructions: "Complete the assigned task.",
    },
    startRunStatuses: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId.make("task-1"),
    rank: "0000000100000000" as Task["rank"],
    projectId: ProjectId.make("project-1"),
    title: "Test task",
    description: "Reply with test",
    output: null,
    status: "new",
    priority: null,
    createdBy: "user",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: ["test"],
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    notBefore: null,
    triggerChangedAt: now,
    ...overrides,
  };
}

function run(overrides: Partial<TaskAgentRun> = {}): TaskAgentRun {
  return {
    id: runId,
    taskId: TaskId.make("task-1"),
    agentId: TaskAgentId.make("agent-1"),
    threadId: ThreadId.make("task-agent-thread-1"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    status: "completed",
    startedAt: now,
    completedAt: "2026-08-04T11:20:00.000Z",
    triggerRunId: null,
    continuesRunId: null,
    ...overrides,
  };
}

test("a started run keeps running while its task's status and tags change", () => {
  NodeAssert.equal(continuesTaskAgentRun(agent(), task({ status: "in_progress", tags: [] })), true);
});

test("closing the task or disabling the agent ends a run", () => {
  NodeAssert.equal(continuesTaskAgentRun(agent(), task({ closedAt: now })), false);
  NodeAssert.equal(continuesTaskAgentRun(agent({ enabled: false }), task()), false);
});

test("an agent runs again only after a trigger change made after its previous run ended", () => {
  const finished = run();
  NodeAssert.equal(
    runsAgain(agent(), task({ triggerChangedAt: "2026-08-04T11:15:00.000Z" }), finished),
    false,
  );
  NodeAssert.equal(
    runsAgain(agent(), task({ triggerChangedAt: "2026-08-04T11:20:00.000Z" }), finished),
    false,
  );
  NodeAssert.equal(
    runsAgain(agent(), task({ triggerChangedAt: "2026-08-04T11:21:00.000Z" }), finished),
    true,
  );
  NodeAssert.equal(
    runsAgain(agent({ updatedAt: "2026-08-04T11:12:00.000Z" }), task(), finished),
    true,
  );
});

test("a run releases its claim by assigning anything but itself", () => {
  const other = TaskAgentRunId.make("run-2");
  const caller = run({ status: "running", completedAt: null });
  // The caller releases itself even after a sibling overwrote the assignment.
  NodeAssert.equal(
    releasedRunId({
      before: task({ assigneeAgentRunId: other }),
      after: task(),
      requestedAssignee: null,
      callerRun: caller,
    }),
    runId,
  );
  NodeAssert.equal(
    releasedRunId({
      before: task(),
      after: task({ assigneeAgentRunId: runId }),
      requestedAssignee: runId,
      callerRun: caller,
    }),
    null,
  );
  NodeAssert.equal(
    releasedRunId({
      before: task({ assigneeAgentRunId: runId }),
      after: task({ assigneeAgentRunId: runId, status: "done" }),
      requestedAssignee: undefined,
      callerRun: caller,
    }),
    null,
  );
  // Without a known caller, the run that lost the assignment to null released it.
  NodeAssert.equal(
    releasedRunId({
      before: task({ assigneeAgentRunId: other }),
      after: task(),
      requestedAssignee: null,
      callerRun: null,
    }),
    other,
  );
  NodeAssert.equal(
    releasedRunId({
      before: task({ assigneeAgentRunId: runId }),
      after: task({ assigneeAgentRunId: other }),
      requestedAssignee: other,
      callerRun: null,
    }),
    null,
  );
});

function deterministicCrypto(): Layer.Layer<Crypto.Crypto> {
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

test("a run prompt gets the global taskExecution plus its project's, from real storage", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-run-prompt-"));
  try {
    const sql = NodeSqliteClient.layer({ filename: NodePath.join(directory, "tasks.sqlite") });
    await Effect.runPromise(
      runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]).pipe(Effect.provide(sql)),
    );
    const store = TaskPromptSettingsStoreLive.pipe(
      Layer.provide(AllChatsInstructionsLive),
      Layer.provide(Layer.mergeAll(sql, deterministicCrypto(), ServerSettings.layerTest())),
    );
    const origin = { source: "settings-page", threadId: null, runId: null } as const;
    const write = (projectId: string | null, text: string) =>
      Effect.flatMap(TaskPromptSettingsStore, (settings) =>
        settings.updateField({
          projectId,
          field: "taskExecution",
          text,
          reason: "test",
          expectedRevision: 0,
          origin,
          dryRun: false,
        }),
      );

    const configuredAgent = agent();
    const assignedTask = task();
    const turns: string[] = [];
    const unused = () => Effect.die("unused repository method");
    const repository = new Proxy(
      {
        listAllActiveAgentRuns: () => Effect.succeed([]),
        listAllAgents: () => Effect.succeed([configuredAgent]),
        listAllTasks: () => Effect.succeed([assignedTask]),
        getById: () => Effect.succeed(Option.some(assignedTask)),
        getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
        findActiveAgentRunForTaskAgent: () => Effect.succeed(Option.none()),
        searchAgentRuns: () => Effect.succeed([]),
        startAgentRun: (run: unknown) => Effect.succeed(Option.some(run as never)),
        appendEvent: (event: unknown) => Effect.succeed(event as never),
      } as unknown as TaskRepositoryShape,
      {
        get: (target, property) =>
          (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
      },
    );
    const layer = TaskAgentServiceLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          store,
          Layer.succeed(TaskRepository, repository),
          Layer.succeed(ThreadManagementService, {
            dispatch: (_command: OrchestrationV2ServerCommand) => Effect.succeed({}),
            sendToThread: (input: ThreadManagementSendInput) =>
              Effect.sync(() => {
                turns.push(input.text);
                return {};
              }),
            streamDomainEvents: Stream.never,
          } as never),
          Layer.succeed(ProjectStoreV2, {
            getShell: (projectId: string) =>
              Effect.succeed(Option.some({ id: projectId, title: "UpComputer" })),
          } as never),
          deterministicCrypto(),
        ),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* write(null, "Global execution rule.");
        yield* write(assignedTask.projectId, "Run the UpComputer checks.");
        yield* write("project-other", "Other project rule.");
        yield* (yield* TaskAgentService).recover;
      }).pipe(Effect.provide(layer)),
    );

    const [turn] = turns;
    NodeAssert.ok(
      turn?.includes(
        'Task execution guidance:\nGlobal execution rule.\n\nProject "UpComputer":\nRun the UpComputer checks.\n\nAssigned task:',
      ),
      turn,
    );
    NodeAssert.ok(!turn?.includes("Other project rule."));
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
