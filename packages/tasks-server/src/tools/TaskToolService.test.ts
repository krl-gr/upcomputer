/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import type {
  Task,
  TaskAgent,
  TaskAgentRun,
  TaskReorderInput,
} from "@upcomputer/tasks-contracts/v1";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@upcomputer/tasks-contracts/v1";
import type { ModelSelection, OrchestrationThread, ThreadId } from "@upcomputer/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../../../../apps/server/src/extensionApi.ts";
import {
  TaskAgentService,
  type TaskAgentServiceShape,
  type TaskChangedInput,
} from "../agents/TaskAgentService.ts";
import {
  TaskToolContextResolver,
  type TaskToolContextResolution,
  type TaskToolContextResolverShape,
} from "../context/TaskToolContextResolver.ts";
import { TaskPersistenceSqlError } from "../persistence/Errors.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  type TaskPromptSettingsStoreShape,
} from "../persistence/TaskPromptSettingsStore.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import { TaskToolService, TaskToolServiceLive } from "./TaskToolService.ts";

const projectDefault = {
  instanceId: "codex",
  model: "gpt-default",
} as unknown as ModelSelection;
const selected = {
  instanceId: "codex",
  model: "gpt-selected",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
  ],
} as unknown as ModelSelection;

const context = { source: "provider", mutationPolicy: "allow" } as const;

function resolution(modelSelection: ModelSelection, explicit: boolean): TaskToolContextResolution {
  return {
    invocation: {
      source: "provider",
      threadId: null,
      turnId: null,
      interactionMode: null,
      runtimeMode: null,
      mutationPolicy: "allow",
    },
    projects: [],
    providers: [],
    resolvedProject: {
      source: "explicit-project-id",
      project: {
        id: "project-2" as never,
        title: "Project two",
        workspaceRoot: "/project-two",
        defaultModelSelection: projectDefault,
      },
    },
    resolvedModel: { source: "project-default", explicit, modelSelection },
    warnings: explicit ? [] : ["contextual fallback"],
    errors: [],
  };
}

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

function testService(
  existing?: TaskAgent,
  repositoryOverrides: Partial<TaskRepositoryShape> = {},
  threads: ReadonlyArray<OrchestrationThread> = [],
  agentService: Partial<TaskAgentServiceShape> = {},
) {
  const saved: TaskAgent[] = [];
  const repository = new Proxy(
    {
      getAgentById: () => Effect.succeed(existing ? Option.some(existing) : Option.none()),
      upsertAgent: (agent: TaskAgent) =>
        Effect.sync(() => {
          saved.push(agent);
          return agent;
        }),
      ...repositoryOverrides,
    } as unknown as TaskRepositoryShape,
    {
      get: (target, key) =>
        Reflect.get(target, key) ?? (() => Effect.die("unused repository method")),
    },
  );
  const resolver: TaskToolContextResolverShape = {
    resolve: ({ args }) =>
      Effect.succeed(
        resolution(
          args.modelSelection ?? (args.modelAlias ? projectDefault : projectDefault),
          args.modelSelection !== undefined || args.modelAlias !== undefined,
        ),
      ),
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskToolContextResolver, resolver),
    Layer.succeed(TaskPromptSettingsStore, {
      get: Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
      update: () => Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS),
    } satisfies TaskPromptSettingsStoreShape),
    Layer.succeed(TaskAgentService, {
      scheduleTaskChanged: () => Effect.void,
      scheduleAgentChanged: () => Effect.void,
      stopRun: () => Effect.succeed(Option.none()),
      messageRun: () => Effect.die("unused messageRun"),
      recover: Effect.void,
      ...agentService,
    } satisfies TaskAgentServiceShape),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: (threadId: ThreadId) =>
        Effect.succeed(Option.fromNullishOr(threads.find((thread) => thread.id === threadId))),
    } as never),
    deterministicCrypto(),
  );
  const layer = TaskToolServiceLive.pipe(Layer.provide(dependencies));
  const call = (
    name: string,
    args: Record<string, unknown>,
    invocationContext: typeof context & { threadId?: ThreadId } = context,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* TaskToolService;
        return yield* service.call({ name, args, context: invocationContext });
      }).pipe(Effect.provide(layer)),
    );
  return { call, saved };
}

test("task_reorder dispatches semantic neighbors and returns the persisted task", async () => {
  const requests: TaskReorderInput[] = [];
  const reorderedTask = {
    id: "task-2",
    rank: "0000000000000010",
    title: "Second",
  } as unknown as Task;
  const { call } = testService(undefined, {
    reorder: (input) =>
      Effect.sync(() => {
        requests.push(input);
        return reorderedTask;
      }),
  });

  const result = await call("task_reorder", {
    id: "task-2",
    afterTaskId: "task-1",
    beforeTaskId: "task-3",
  });

  NodeAssert.equal(result.isError, false, result.text);
  NodeAssert.deepEqual(requests, [{ id: "task-2", afterTaskId: "task-1", beforeTaskId: "task-3" }]);
  NodeAssert.equal(JSON.parse(result.text).task.rank, "0000000000000010");
});

test("task_reorder exposes invalid-neighbor repository failures through actual tool dispatch", async () => {
  const { call } = testService(undefined, {
    reorder: () =>
      Effect.fail(
        new TaskPersistenceSqlError({
          operation: "reorder task",
          detail: "Neighbor tasks must be adjacent in global order.",
        }),
      ),
  });

  const result = await call("task_reorder", {
    id: "task-2",
    beforeTaskId: "missing-task",
  });

  NodeAssert.equal(result.isError, true);
  NodeAssert.match(result.text, /Neighbor tasks must be adjacent/);
});

test("agent_create rejects an implicit contextual model through actual tool dispatch", async () => {
  const { call, saved } = testService();
  const result = await call("agent_create", { name: "Agent", projectId: "project-2" });

  NodeAssert.equal(result.isError, true);
  NodeAssert.match(result.text, /requires an explicit model decision/);
  NodeAssert.equal(saved.length, 0);
});

test("agent_create accepts every explicit model input and preserves options", async () => {
  const inputs = [
    { name: "Top level", projectId: "project-2", modelSelection: selected },
    {
      name: "Config",
      projectId: "project-2",
      config: { role: "Config", modelSelection: selected, instructions: "Do the work." },
    },
    { name: "Alias", projectId: "project-2", modelAlias: "project" },
  ];

  for (const [index, input] of inputs.entries()) {
    const harness = testService();
    const result = await harness.call("agent_create", input);
    NodeAssert.equal(result.isError, false, result.text);
    NodeAssert.deepEqual(
      harness.saved[0]?.config.modelSelection,
      index === 2 ? projectDefault : selected,
    );
  }
});

test("agent_update keeps stored options when project resolution returns another fallback", async () => {
  const existing = {
    id: "agent-1",
    projectId: "project-1",
    name: "Agent",
    enabled: true,
    startStatuses: [],
    startTags: [],
    config: { role: "Agent", modelSelection: selected, instructions: "Old instructions." },
    concurrencyKey: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  } as unknown as TaskAgent;
  const { call, saved } = testService(existing);
  const result = await call("agent_update", {
    id: "agent-1",
    projectId: "project-2",
    instructions: "New instructions.",
  });

  NodeAssert.equal(result.isError, false, result.text);
  NodeAssert.equal(saved[0]?.projectId, "project-2");
  NodeAssert.equal(saved[0]?.config.instructions, "New instructions.");
  NodeAssert.deepEqual(saved[0]?.config.modelSelection, selected);
});

test("task_create passes trusted thread context independently of model origin arguments", async () => {
  let persisted: import("../persistence/TaskRepository.ts").PersistTaskInput | undefined;
  const { call } = testService(undefined, {
    upsert: (input) =>
      Effect.sync(() => {
        persisted = input;
        return {
          ...input,
          rank: "0000000000000010",
          rootThreadId: null,
          parentTaskId: null,
          parentRunId: null,
        } as Task;
      }),
  });
  const result = await call(
    "task_create",
    { title: "Child", description: "", status: "Backlog", sourceThreadId: "model-source" },
    { ...context, threadId: "actual-agent-thread" as never },
  );
  NodeAssert.equal(result.isError, false, result.text);
  NodeAssert.equal(persisted?.originThreadId, "actual-agent-thread");
  NodeAssert.equal(persisted?.sourceRunId, null);
});

const transcriptRun = {
  id: "run-1",
  taskId: "task-1",
  agentId: "agent-1",
  threadId: "thread-run",
  status: "failed",
  startedAt: "2026-09-24T10:00:00.000Z",
  completedAt: "2026-09-24T10:05:00.000Z",
} as unknown as TaskAgentRun;

const transcriptThread = {
  id: "thread-run",
  session: { lastError: "Provider turn failed." },
  messages: [
    { role: "user", text: "Do the task.", createdAt: "2026-09-24T10:00:01.000Z" },
    { role: "assistant", text: "x".repeat(5_000), createdAt: "2026-09-24T10:00:04.000Z" },
  ],
  activities: [
    { kind: "tool.started", summary: "Run tests", createdAt: "2026-09-24T10:00:02.000Z" },
    { kind: "runtime.error", summary: "Boom", createdAt: "2026-09-24T10:00:03.000Z" },
  ],
} as unknown as OrchestrationThread;

function transcriptService() {
  return testService(
    undefined,
    {
      getAgentRunById: ({ id }) =>
        Effect.succeed(id === transcriptRun.id ? Option.some(transcriptRun) : Option.none()),
      findLatestAgentRunByThreadId: ({ threadId }) =>
        Effect.succeed(
          threadId === transcriptRun.threadId ? Option.some(transcriptRun) : Option.none(),
        ),
    },
    [transcriptThread, { ...transcriptThread, id: "thread-chat" } as OrchestrationThread],
  );
}

test("agent_run_transcript resolves by runId and threadId with ordered entries and failure reason", async () => {
  const { call } = transcriptService();
  const byRun = await call("agent_run_transcript", { runId: "run-1" });
  const byThread = await call("agent_run_transcript", { threadId: "thread-run" });

  NodeAssert.equal(byRun.isError, false, byRun.text);
  NodeAssert.equal(byRun.text, byThread.text);
  const transcript = JSON.parse(byRun.text);
  NodeAssert.equal(transcript.run.status, "failed");
  NodeAssert.equal(transcript.failureReason, "Provider turn failed.");
  NodeAssert.equal(transcript.olderEntriesOmitted, false);
  NodeAssert.deepEqual(
    transcript.entries.map((entry: { kind?: string; role?: string }) => entry.kind ?? entry.role),
    ["user", "tool.started", "runtime.error", "assistant"],
  );
  NodeAssert.match(transcript.entries[3].text, /… \[truncated 1000 chars\]$/);
});

test("agent_run_transcript applies tail, maxChars, and includeActivities", async () => {
  const { call } = transcriptService();
  const tail = JSON.parse((await call("agent_run_transcript", { runId: "run-1", tail: 2 })).text);
  NodeAssert.equal(tail.olderEntriesOmitted, true);
  NodeAssert.deepEqual(
    tail.entries.map((entry: { type: string }) => entry.type),
    ["activity", "message"],
  );

  const capped = JSON.parse(
    (await call("agent_run_transcript", { runId: "run-1", maxChars: 100 })).text,
  );
  NodeAssert.equal(capped.olderEntriesOmitted, true);
  NodeAssert.equal(capped.entries.length, 1);
  NodeAssert.match(capped.entries[0].text, /^x{100}… \[truncated 4900 chars\]$/);

  const messagesOnly = JSON.parse(
    (await call("agent_run_transcript", { threadId: "thread-run", includeActivities: false })).text,
  );
  NodeAssert.deepEqual(
    messagesOnly.entries.map((entry: { role: string }) => entry.role),
    ["user", "assistant"],
  );
});

test("agent_run_transcript rejects threads that do not belong to a task-agent run", async () => {
  const { call } = transcriptService();
  const result = await call("agent_run_transcript", { threadId: "thread-chat" });
  NodeAssert.equal(result.isError, true);
  NodeAssert.match(result.text, /does not belong to a task-agent run/);

  const ambiguous = await call("agent_run_transcript", {
    runId: "run-1",
    threadId: "thread-run",
  });
  NodeAssert.equal(ambiguous.isError, true);
});

test("task_update from a run that assigns the task away releases that run, not the sibling it overwrote", async () => {
  const scheduled: TaskChangedInput[] = [];
  const before = { id: "task-1", assigneeAgentRunId: "run-sibling" } as unknown as Task;
  const after = {
    id: "task-1",
    assigneeAgentRunId: null,
    status: "Needs Review",
  } as unknown as Task;
  const caller = { id: "run-caller", taskId: "task-1" } as unknown as TaskAgentRun;
  const { call } = testService(
    undefined,
    {
      getById: () => Effect.succeed(Option.some(before)),
      update: () => Effect.succeed(after),
      findActiveAgentRunByThreadId: () => Effect.succeed(Option.some(caller)),
    },
    [],
    { scheduleTaskChanged: (input) => Effect.sync(() => void scheduled.push(input)) },
  );
  const result = await call(
    "task_update",
    { id: "task-1", status: "Needs Review", assigneeAgentRunId: null },
    { ...context, threadId: "thread-caller" as ThreadId },
  );
  NodeAssert.equal(result.isError, false);
  NodeAssert.equal(scheduled[0]?.releasedRunId, "run-caller");
});

test("agent_run_stop stops an active run and refuses one that already ended", async () => {
  const active = { id: "run-1", completedAt: null } as unknown as TaskAgentRun;
  const stopped = { id: "run-1", status: "stopped", completedAt: "2026-10-01T00:00:00.000Z" };
  const stops: string[] = [];
  let current: TaskAgentRun = active;
  const { call } = testService(
    undefined,
    { getAgentRunById: () => Effect.sync(() => Option.some(current)) },
    [],
    {
      stopRun: ({ id }) =>
        Effect.sync(() => {
          stops.push(id);
          current = stopped as unknown as TaskAgentRun;
          return Option.some(current);
        }),
    },
  );
  const first = await call("agent_run_stop", { id: "run-1" });
  NodeAssert.equal(first.isError, false);
  NodeAssert.equal(JSON.parse(first.text).run.status, "stopped");
  const second = await call("agent_run_stop", { id: "run-1" });
  NodeAssert.equal(second.isError, true);
  NodeAssert.deepEqual(stops, ["run-1"]);
});

test("agent_run_message validates input, reports continuations, and returns refusals as errors", async () => {
  const continuation = {
    id: "run-2",
    threadId: "thread-1",
    continuesRunId: "run-1",
  } as unknown as TaskAgentRun;
  const messages: Array<{ id: string; text: string }> = [];
  const { call } = testService(
    undefined,
    {
      getAgentRunById: () =>
        Effect.succeed(Option.some({ id: "run-1" } as unknown as TaskAgentRun)),
    },
    [],
    {
      messageRun: ({ id, text }) =>
        Effect.sync(() => {
          messages.push({ id, text });
          return id === "run-1"
            ? { ok: true as const, run: continuation, continued: true }
            : {
                ok: false as const,
                error: "Agent 'Dev' already has active run 'run-9' on task 'task-1'.",
                activeRunId: "run-9" as TaskAgentRun["id"],
              };
        }),
    },
  );

  for (const args of [{ runId: "run-1" }, { runId: "run-1", text: "   " }, { text: "go" }]) {
    NodeAssert.equal((await call("agent_run_message", args)).isError, true, JSON.stringify(args));
  }
  NodeAssert.deepEqual(messages, [], "invalid input sends nothing");

  const continued = await call("agent_run_message", { runId: "run-1", text: " go on " });
  NodeAssert.equal(continued.isError, false);
  NodeAssert.deepEqual(JSON.parse(continued.text), {
    run: continuation,
    continued: true,
    continuesRunId: "run-1",
  });
  NodeAssert.deepEqual(messages, [{ id: "run-1", text: "go on" }]);

  const refused = await call("agent_run_message", { runId: "run-3", text: "go" });
  NodeAssert.equal(refused.isError, true);
  NodeAssert.equal(JSON.parse(refused.text).activeRunId, "run-9");

  const dryRun = await call(
    "agent_run_message",
    { runId: "run-1", text: "go" },
    { ...context, mutationPolicy: "deny" as never },
  );
  NodeAssert.equal(JSON.parse(dryRun.text).dryRun, true);
  NodeAssert.equal(messages.length, 2, "a dry run sends nothing");
  NodeAssert.ok(TASK_TOOL_SPECS.some((spec) => spec.name === "agent_run_message"));
});

test("agent tools expose run-status triggers and no concurrency key", () => {
  for (const name of ["agent_create", "agent_update"]) {
    const properties = (
      TASK_TOOL_SPECS.find((spec) => spec.name === name)?.inputSchema as {
        properties: Record<string, unknown>;
      }
    ).properties;
    NodeAssert.ok("startRunStatuses" in properties);
    NodeAssert.equal("concurrencyKey" in properties, false);
  }
});
