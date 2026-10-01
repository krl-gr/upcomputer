/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
} from "@upcomputer/tasks-contracts/v1";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@upcomputer/tasks-contracts/v1";
import {
  MessageId,
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
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  type TaskPromptSettingsStoreShape,
} from "../persistence/TaskPromptSettingsStore.ts";
import { makeTaskAgentResultConsumer } from "./TaskAgentResultFinalization.ts";
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

test("task-agent startup forwards complete advertised Astra options to run and both thread commands", async () => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("up"),
    model: "openai-codex/gpt-6-astra",
    options: [
      { id: "thinkingLevel", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ],
  } as const;
  const configuredAgent = agent({
    config: {
      role: "Test agent",
      modelSelection,
      instructions: "Complete the assigned task.",
    },
  });
  const assignedTask = task();
  const commands: OrchestrationCommand[] = [];
  const runs: Array<{ readonly modelSelection: unknown }> = [];
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
      createAgentRun: (run: { readonly modelSelection: unknown }) =>
        Effect.sync(() => {
          runs.push(run);
          return run as never;
        }),
      appendEvent: (event: unknown) => Effect.succeed(event as never),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, property) =>
        (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
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
    Layer.succeed(ProjectionSnapshotQuery, {} as never),
    deterministicCrypto(),
  );
  const layer = TaskAgentServiceLive.pipe(Layer.provide(dependencies));

  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(layer)),
  );

  NodeAssert.deepEqual(runs[0]?.modelSelection, modelSelection);
  NodeAssert.deepEqual(
    commands.map((command) =>
      command.type === "thread.create" || command.type === "thread.turn.start"
        ? command.modelSelection
        : null,
    ),
    [modelSelection, modelSelection],
  );
  const turn = commands.find((command) => command.type === "thread.turn.start");
  NodeAssert.equal(turn?.type, "thread.turn.start");
  if (turn?.type === "thread.turn.start") {
    NodeAssert.match(
      turn.message.text,
      /rank: 0000000100000000 \(global position 1 of 1 in this environment; informational only\)/,
    );
  }
});

test("restart interrupts persisted active runs, clears assignment, and does not auto-replay", async () => {
  const configuredAgent = agent();
  const assignedTask = task({ assigneeAgentRunId: runId });
  const persistedRun = {
    id: runId,
    taskId: assignedTask.id,
    agentId: configuredAgent.id,
    threadId: ThreadId.make("task-agent-thread-1"),
    modelSelection: configuredAgent.config.modelSelection,
    status: "running",
    startedAt: now,
    completedAt: null,
  } as const;
  const completions: Array<{ readonly status: string }> = [];
  const updates: Array<{
    readonly assigneeAgentRunId?: string | null;
    readonly output?: unknown;
  }> = [];
  const events: unknown[] = [];
  const commands: OrchestrationCommand[] = [];
  let createCalls = 0;
  let sessionStatus: "running" | "error" | "ready" = "running";
  let completionClaimed = true;
  const unused = () => Effect.die("unused repository method");
  const repository = new Proxy(
    {
      listAllActiveAgentRuns: () => Effect.succeed([persistedRun]),
      listAllAgents: () => Effect.succeed([configuredAgent]),
      listAllTasks: () => Effect.succeed([assignedTask]),
      getById: () => Effect.succeed(Option.some(assignedTask)),
      getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
      listActiveAgentRunsForTask: () => Effect.succeed([]),
      findActiveAgentRunForTaskAgent: () => Effect.succeed(Option.some(persistedRun)),
      // Finalization re-checks that the run still owns its thread.
      getAgentRunById: () => Effect.succeed(Option.some({ completedAt: null } as never)),
      findActiveAgentRunByThreadId: () => Effect.succeed(Option.none()),
      claimAgentRunFinalization: (input: { readonly finalizingStatus: string }) =>
        Effect.sync(() => {
          completions.push({ status: input.finalizingStatus.replace("finalizing:", "") });
          return completionClaimed;
        }),
      finalizeAgentRun: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          updates.push({
            ...(input.releaseAssignment ? { assigneeAgentRunId: null } : {}),
            output: input.taskOutput,
          });
          return true;
        }),
      appendEvent: (event: unknown) =>
        Effect.sync(() => {
          events.push(event);
          return event as never;
        }),
      createAgentRun: () =>
        Effect.sync(() => {
          createCalls += 1;
          return persistedRun as never;
        }),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, property) =>
        (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
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
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            messages: [],
            session: {
              status: sessionStatus,
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "approval-required",
              activeTurnId: sessionStatus === "running" ? "turn-1" : null,
              lastError: sessionStatus === "error" ? "provider failed before first response" : null,
              updatedAt: now,
            },
          }),
        ),
    } as never),
    deterministicCrypto(),
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
  );

  NodeAssert.deepEqual(
    completions.map(({ status }) => status),
    ["interrupted"],
  );
  NodeAssert.equal(updates[0]?.assigneeAgentRunId, null);
  NodeAssert.match(
    String((updates[0] as Record<string, unknown> | undefined)?.output),
    /interrupted/,
  );
  NodeAssert.equal(createCalls, 0, "startup recovery must not replay interrupted work");
  NodeAssert.deepEqual(
    commands.map(({ type }) => type),
    ["thread.session.set", "thread.session.stop"],
  );

  completions.length = 0;
  updates.length = 0;
  commands.length = 0;
  sessionStatus = "error";
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
  );
  NodeAssert.deepEqual(
    completions.map(({ status }) => status),
    ["failed"],
  );
  NodeAssert.equal(updates[0]?.assigneeAgentRunId, null);
  NodeAssert.match(
    String((updates[0] as Record<string, unknown> | undefined)?.output),
    /provider failed before first response/,
  );
  NodeAssert.equal(
    createCalls,
    0,
    "provider startup failure must release rather than replay the run",
  );
  NodeAssert.deepEqual(
    commands,
    [],
    "an already-terminal provider session needs no replayed command",
  );

  completions.length = 0;
  updates.length = 0;
  sessionStatus = "ready";
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
  );
  NodeAssert.deepEqual(
    completions.map(({ status }) => status),
    ["failed"],
  );
  NodeAssert.match(
    String((updates[0] as Record<string, unknown> | undefined)?.output),
    /without a valid task-agent result/,
  );
  NodeAssert.deepEqual(
    commands.map(({ type }) => type),
    ["thread.session.set", "thread.session.stop"],
    "an idle live provider session must be stopped so it cannot keep working",
  );

  completions.length = 0;
  updates.length = 0;
  events.length = 0;
  completionClaimed = false;
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
  );
  NodeAssert.deepEqual(
    completions.map(({ status }) => status),
    ["failed"],
    "the stale reconciler may attempt its compare-and-set once",
  );
  NodeAssert.deepEqual(updates, [], "a lost completion race must not overwrite the task result");
  NodeAssert.deepEqual(events, [], "a lost completion race must not append a failure event");
});

test("live ready-result reconciliation waits for consumption and cannot overwrite its winner", async () => {
  const configuredAgent = agent();
  const assignedTask = task({ assigneeAgentRunId: runId });
  const persistedRun = {
    id: runId,
    taskId: assignedTask.id,
    agentId: configuredAgent.id,
    threadId: ThreadId.make("task-agent-thread-ready-race"),
    modelSelection: configuredAgent.config.modelSelection,
    status: "running",
    startedAt: now,
    completedAt: null,
  } as const;
  let sessionUpdatedAt = "2099-01-01T00:00:00.000Z";
  let completionAttempts = 0;
  const taskMutations: unknown[] = [];
  const unused = () => Effect.die("unused repository method");
  const repository = new Proxy(
    {
      listAllActiveAgentRuns: () => Effect.succeed([persistedRun]),
      getById: () => Effect.succeed(Option.some(assignedTask)),
      getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
      claimAgentRunFinalization: () =>
        Effect.sync(() => {
          completionAttempts += 1;
          return false;
        }),
      update: (input: unknown) =>
        Effect.sync(() => {
          taskMutations.push(input);
          return assignedTask;
        }),
      appendEvent: (input: unknown) =>
        Effect.sync(() => {
          taskMutations.push(input);
          return input as never;
        }),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, property) =>
        (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskPromptSettingsStore, {
      get: Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
      update: () => Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
    } satisfies TaskPromptSettingsStoreShape),
    Layer.succeed(OrchestrationEngineService, {
      dispatch: () => Effect.succeed({ sequence: 1 }),
    } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            messages: [],
            session: {
              status: "ready",
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "approval-required",
              activeTurnId: null,
              lastError: null,
              updatedAt: sessionUpdatedAt,
            },
          }),
        ),
    } as never),
    deterministicCrypto(),
  );

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* TaskAgentService;
        yield* Effect.sleep("1100 millis");
        NodeAssert.equal(
          completionAttempts,
          0,
          "a just-finished turn remains available to its result consumer",
        );

        sessionUpdatedAt = "2020-01-01T00:00:00.000Z";
        yield* Effect.sleep("1100 millis");
        NodeAssert.equal(completionAttempts, 1, "an expired missing-result run is reconciled");
        NodeAssert.deepEqual(
          taskMutations,
          [],
          "losing the completion CAS leaves task output/history intact",
        );
      }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
    ),
  );
});

test("failed cleanup leaves finalization active and retry releases the assignment", async () => {
  const configuredAgent = agent();
  const assignedTask = task({ assigneeAgentRunId: runId });
  const baseRun = {
    id: runId,
    taskId: assignedTask.id,
    agentId: configuredAgent.id,
    threadId: ThreadId.make("task-agent-thread-retry-finalization"),
    modelSelection: configuredAgent.config.modelSelection,
    startedAt: now,
    completedAt: null,
  } as const;
  let runStatus = "running";
  let completed = false;
  let failNextDispatch = true;
  const finalizations: Array<Record<string, unknown>> = [];
  const unused = () => Effect.die("unused repository method");
  const repository = new Proxy(
    {
      listAllActiveAgentRuns: () =>
        Effect.sync(() => (completed ? [] : [{ ...baseRun, status: runStatus }])),
      listAllAgents: () => Effect.succeed([configuredAgent]),
      listAllTasks: () => Effect.succeed([assignedTask]),
      getById: () => Effect.succeed(Option.some(assignedTask)),
      getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
      findActiveAgentRunForTaskAgent: () =>
        Effect.sync(() =>
          completed ? Option.none() : Option.some({ ...baseRun, status: runStatus }),
        ),
      // Finalization re-checks that the run still owns its thread.
      getAgentRunById: () => Effect.succeed(Option.some({ completedAt: null } as never)),
      findActiveAgentRunByThreadId: () => Effect.succeed(Option.none()),
      claimAgentRunFinalization: (input: { readonly finalizingStatus: string }) =>
        Effect.sync(() => {
          if (runStatus.startsWith("finalizing:") && runStatus !== input.finalizingStatus) {
            return false;
          }
          runStatus = input.finalizingStatus;
          return true;
        }),
      finalizeAgentRun: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          finalizations.push(input);
          completed = true;
          return true;
        }),
      listActiveAgentRunsForTask: () => Effect.succeed([]),
      // The finished run is the agent's latest; the task has not changed since.
      searchAgentRuns: () =>
        Effect.succeed([
          { ...baseRun, status: "interrupted", completedAt: "2026-08-04T11:30:00.000Z" },
        ]),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, property) =>
        (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskPromptSettingsStore, {
      get: Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
      update: () => Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
    } satisfies TaskPromptSettingsStoreShape),
    Layer.succeed(OrchestrationEngineService, {
      dispatch: () =>
        Effect.suspend(() => {
          if (failNextDispatch) {
            failNextDispatch = false;
            return Effect.fail(new Error("simulated terminal-session persistence failure"));
          }
          return Effect.succeed({ sequence: 1 });
        }),
    } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            session: {
              status: "running",
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "approval-required",
              activeTurnId: "turn-1",
              lastError: null,
              updatedAt: now,
            },
          }),
        ),
    } as never),
    deterministicCrypto(),
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
  );
  NodeAssert.equal(runStatus, "finalizing:interrupted");
  NodeAssert.equal(completed, false, "cleanup failure must keep the run discoverable");
  NodeAssert.deepEqual(finalizations, []);

  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskAgentService;
      yield* service.recover;
    }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
  );
  NodeAssert.equal(completed, true);
  NodeAssert.equal(finalizations.length, 1);
  const finalized = finalizations.at(0) as Record<string, unknown> | undefined;
  NodeAssert.equal(finalized?.releaseAssignment, true);
  NodeAssert.equal(finalized?.status, "interrupted");
});

test("live reconciliation waits for a fresh run's thread but still fails a missing one", async () => {
  const configuredAgent = agent();
  const assignedTask = task();
  // startAgent persists the run before dispatching thread.create.
  let startedAt = "2099-01-01T00:00:00.000Z";
  let replays = 0;
  const finalizations: Array<Record<string, unknown>> = [];
  const unused = () => Effect.die("unused repository method");
  const repository = new Proxy(
    {
      listAllActiveAgentRuns: () =>
        Effect.sync(() =>
          finalizations.length > 0
            ? []
            : [
                {
                  id: runId,
                  taskId: assignedTask.id,
                  agentId: configuredAgent.id,
                  threadId: ThreadId.make("task-agent-thread-not-projected"),
                  modelSelection: configuredAgent.config.modelSelection,
                  status: "running",
                  startedAt,
                  completedAt: null,
                },
              ],
        ),
      getById: () => Effect.succeed(Option.some(assignedTask)),
      getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
      // Finalization re-checks that the run still owns its thread.
      getAgentRunById: () => Effect.succeed(Option.some({ completedAt: null } as never)),
      findActiveAgentRunByThreadId: () => Effect.succeed(Option.none()),
      claimAgentRunFinalization: () => Effect.succeed(true),
      finalizeAgentRun: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          finalizations.push(input);
          return true;
        }),
      // The failure schedules a run-finished reconcile; the failed agent must not replay.
      listActiveAgentRunsForTask: () => Effect.succeed([]),
      listAllAgents: () => Effect.succeed([configuredAgent]),
      findActiveAgentRunForTaskAgent: () => Effect.succeed(Option.none()),
      searchAgentRuns: () =>
        Effect.succeed([
          {
            id: runId,
            taskId: assignedTask.id,
            agentId: configuredAgent.id,
            threadId: ThreadId.make("task-agent-thread-not-projected"),
            modelSelection: configuredAgent.config.modelSelection,
            status: "failed",
            startedAt: "2026-08-04T11:20:00.000Z",
            completedAt: "2026-08-04T11:30:00.000Z",
            triggerRunId: null,
            continuesRunId: null,
          },
        ]),
      createAgentRun: () =>
        Effect.sync(() => {
          replays += 1;
          return null as never;
        }),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, property) =>
        (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskPromptSettingsStore, {
      get: Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
      update: () => Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
    } satisfies TaskPromptSettingsStoreShape),
    Layer.succeed(OrchestrationEngineService, {
      dispatch: () => Effect.succeed({ sequence: 1 }),
    } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: () => Effect.succeed(Option.none()),
    } as never),
    deterministicCrypto(),
  );

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* TaskAgentService;
        yield* Effect.sleep("1100 millis");
        NodeAssert.deepEqual(
          finalizations,
          [],
          "a just-started run's thread may not be projected yet",
        );

        startedAt = "2020-01-01T00:00:00.000Z";
        yield* Effect.sleep("1100 millis");
        const finalized = finalizations.at(0) as Record<string, unknown> | undefined;
        NodeAssert.equal(finalizations.length, 1);
        NodeAssert.equal(finalized?.status, "failed");
        NodeAssert.match(String(finalized?.taskOutput), /execution thread is missing/);
        NodeAssert.equal(replays, 0, "a failed run is not replayed without a trigger change");
      }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
    ),
  );
});

test("live reconciliation consumes a result the event stream missed, and finalizes once", async () => {
  const configuredAgent = agent();
  const assignedTask = task({ status: "in_progress", assigneeAgentRunId: runId });
  const threadId = ThreadId.make("task-agent-thread-result-without-detail");
  const run = {
    id: runId,
    taskId: assignedTask.id,
    agentId: configuredAgent.id,
    threadId,
    modelSelection: configuredAgent.config.modelSelection,
    status: "running",
    startedAt: now,
    completedAt: null,
  } as const;
  let runStatus = "running";
  const finalizations: Array<Record<string, unknown>> = [];
  const messages: unknown[] = [];
  const unused = () => Effect.die("unused repository method");
  const repository = new Proxy(
    {
      listAllActiveAgentRuns: () =>
        Effect.sync(() => (finalizations.length > 0 ? [] : [{ ...run, status: runStatus }])),
      // Stays visible so a late event-path delivery reaches the finalization claim.
      findActiveAgentRunByThreadId: () =>
        Effect.sync(() => Option.some({ ...run, status: runStatus })),
      getById: () => Effect.succeed(Option.some(assignedTask)),
      getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
      claimAgentRunFinalization: (input: { readonly finalizingStatus: string }) =>
        Effect.sync(() => {
          if (runStatus !== "running") return false;
          runStatus = input.finalizingStatus;
          return true;
        }),
      finalizeAgentRun: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          finalizations.push(input);
          return true;
        }),
      // The reported status change reschedules the task.
      appendEvent: (event: unknown) => Effect.succeed(event as never),
      listActiveAgentRunsForTask: () => Effect.succeed([]),
      listAllAgents: () => Effect.succeed([]),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, property) =>
        (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskPromptSettingsStore, {
      get: Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
      update: () => Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
    } satisfies TaskPromptSettingsStoreShape),
    Layer.succeed(OrchestrationEngineService, {
      dispatch: () => Effect.succeed({ sequence: 1 }),
    } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: () =>
        Effect.sync(() =>
          Option.some({
            messages,
            session: {
              status: "ready",
              providerName: "claudeAgent",
              providerInstanceId: ProviderInstanceId.make("claudeAgent"),
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2099-01-01T00:00:00.000Z",
            },
          }),
        ),
    } as never),
    deterministicCrypto(),
  );
  const markdown = `Done.\n\n~~~task_agent_result\n{"status":"Needs Agent Review","summary":"Wrote the file.","blocked":false,"events":[]}\n~~~`;

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* TaskAgentService;
        yield* Effect.sleep("1100 millis");
        NodeAssert.deepEqual(finalizations, [], "the turn ended before the reply was projected");

        messages.push({
          id: MessageId.make("assistant-final"),
          role: "assistant",
          text: markdown,
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        });
        yield* Effect.sleep("1100 millis");
        NodeAssert.equal(finalizations.length, 1);
        const finalized = finalizations.at(0) as Record<string, unknown> | undefined;
        NodeAssert.equal(finalized?.status, "completed");
        NodeAssert.equal(finalized?.taskStatus, "Needs Agent Review");
        NodeAssert.equal(finalized?.taskOutput, "Wrote the file.");

        // A late event-path delivery of the same result must not finalize again.
        const consumeEvent = makeTaskAgentResultConsumer({
          repository,
          scheduleTaskChanged: () => Effect.void,
        });
        NodeAssert.equal(yield* consumeEvent({ threadId, markdown, createdAt: now }), true);
        yield* Effect.sleep("1100 millis");
        NodeAssert.equal(finalizations.length, 1);
      }).pipe(Effect.provide(TaskAgentServiceLive.pipe(Layer.provide(dependencies)))),
    ),
  );
});
