import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  ProjectId,
  ThreadId as ThreadIdBrand,
  CommandId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  RpcScopeAuthorization,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  TASKS_RPC_METHODS,
  TaskAgentId,
  TaskId,
  TasksRpcGroup,
  type Task,
  type TaskAgent,
} from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { McpSchema, McpServer } from "effect/unstable/ai";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import { rpcScopeAuthorizationLayer } from "../../../../apps/server/src/auth/RpcAuthorization.ts";
import { McpInvocationContext } from "../../../../apps/server/src/mcp/McpInvocationContext.ts";
import { ProviderRegistry } from "../../../../apps/server/src/provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { SqlitePersistenceMemory } from "../../../../apps/server/src/persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../../../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts";
import type {
  ProviderAdapterV2Event,
  ProviderAdapterV2Shape,
  ProviderAdapterV2TurnInput,
} from "../../../../apps/server/src/orchestration-v2/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../../../../apps/server/src/orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProjectStore from "../../../../apps/server/src/orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../../../../apps/server/src/orchestration-v2/ThreadManagementService.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "../../../../apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts";
import { checkpointWorkspace } from "../../../../apps/server/src/orchestration-v2/testkit/ReplayFixtureWorkspace.ts";
import {
  composeExperimentalServerFeatures,
  productFeatureLayer,
  productMcpToolsLayer,
  rpcContributionHandlersLayer,
  rpcContributionScopes,
  ServerProduct,
} from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TASK_TOOL_SPECS } from "../tools/TaskToolDefinitions.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TASKS_SERVER_FEATURE } from "../serverFeature.ts";
import { TaskAgentService } from "./TaskAgentService.ts";
import { TaskSourceWake } from "./TaskSourceWake.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-task-agent-test");
const agentModel = { instanceId, model: "task-agent-model" } satisfies ModelSelection;
const projectId = ProjectId.make("project:task-agents-v2");

/** A message containing this marker keeps its turn running until it is interrupted. */
const HOLD = "[hold-turn]";
/** A message containing this marker fails its turn. */
const FAIL = "[fail-turn]";

interface StartedTurn {
  readonly threadId: ThreadId;
  readonly model: string;
  readonly cwd: string | null;
  readonly text: string;
}

/**
 * A scripted provider: each turn replies with a task_agent_result block and
 * completes, unless its message holds the turn open for a stop or fails it.
 */
function makeTaskAgentAdapter(
  started: Ref.Ref<ReadonlyArray<StartedTurn>>,
): ProviderAdapterV2Shape {
  return {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (sessionInput) =>
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
        const held = new Map<ProviderTurnId, ProviderAdapterV2TurnInput>();
        const now = yield* DateTime.now;
        const providerTurn = (
          input: ProviderAdapterV2TurnInput,
          id: ProviderTurnId,
          status: "running" | "completed" | "interrupted" | "failed",
          at: DateTime.Utc,
        ): ProviderAdapterV2Event => ({
          type: "provider_turn.updated",
          driver,
          providerTurn: {
            id,
            providerThreadId: input.providerThread.id,
            nodeId: input.rootNodeId,
            runAttemptId: input.attemptId,
            nativeTurnRef: { driver, nativeId: `native:${id}`, strength: "strong" },
            ordinal: input.providerTurnOrdinal,
            status,
            startedAt: at,
            completedAt: status === "running" ? null : at,
          },
        });
        return {
          instanceId,
          driver,
          providerSessionId: sessionInput.providerSessionId,
          providerSession: {
            id: sessionInput.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd: sessionInput.runtimePolicy.cwd ?? "/fallback",
            model: sessionInput.modelSelection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: (threadInput) =>
            Effect.gen(function* () {
              const createdAt = yield* DateTime.now;
              return {
                id: ProviderThreadId.make(`provider-thread:${threadInput.threadId}`),
                driver,
                providerInstanceId: instanceId,
                providerSessionId: sessionInput.providerSessionId,
                appThreadId: threadInput.threadId,
                ownerNodeId: null,
                nativeThreadRef: {
                  driver,
                  nativeId: `native-thread:${threadInput.threadId}`,
                  strength: "strong",
                },
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt,
                updatedAt: createdAt,
              } satisfies OrchestrationV2ProviderThread;
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (input) =>
            Effect.gen(function* () {
              yield* Ref.update(started, (turns) => [
                ...turns,
                {
                  threadId: input.threadId,
                  model: input.modelSelection.model,
                  cwd: input.runtimePolicy.cwd,
                  text: input.message.text,
                },
              ]);
              const at = yield* DateTime.now;
              const id = ProviderTurnId.make(`provider-turn:${input.attemptId}`);
              yield* Queue.offer(events, providerTurn(input, id, "running", at));
              if (input.message.text.includes(HOLD)) {
                held.set(id, input);
                return;
              }
              if (input.message.text.includes(FAIL)) {
                yield* Queue.offer(events, providerTurn(input, id, "failed", at));
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver,
                  providerThreadId: input.providerThread.id,
                  providerTurnId: id,
                  runOrdinal: input.runOrdinal,
                  failureItemOrdinal: input.runOrdinal * 100 + 2,
                  status: "failed",
                  failure: {
                    class: "provider_error",
                    message: "Scripted provider failure.",
                    code: "scripted_failure",
                    retryable: false,
                  },
                  threadDisposition: "reusable",
                });
                return;
              }
              const summary = `Handled ${input.runOrdinal}`;
              yield* Queue.offer(events, {
                type: "message.updated",
                driver,
                message: {
                  id: `message:${input.runId}:reply` as never,
                  threadId: input.threadId,
                  runId: input.runId,
                  nodeId: null,
                  role: "assistant",
                  text: `Done.\n\n~~~task_agent_result\n${JSON.stringify({
                    status: "Needs Review",
                    summary,
                    blocked: false,
                    events: [],
                  })}\n~~~`,
                  attachments: [],
                  streaming: false,
                  createdBy: "agent",
                  creationSource: "provider",
                  createdAt: at,
                  updatedAt: at,
                },
              });
              yield* Queue.offer(events, providerTurn(input, id, "completed", at));
              yield* Queue.offer(events, {
                type: "turn.terminal",
                driver,
                providerThreadId: input.providerThread.id,
                providerTurnId: id,
                runOrdinal: input.runOrdinal,
                status: "completed",
                failure: null,
                threadDisposition: "reusable",
              });
            }),
          steerTurn: () => Effect.void,
          interruptTurn: ({ providerTurnId }) =>
            Effect.gen(function* () {
              const input = held.get(providerTurnId);
              if (input === undefined) return;
              held.delete(providerTurnId);
              const at = yield* DateTime.now;
              yield* Queue.offer(events, providerTurn(input, providerTurnId, "interrupted", at));
              yield* Queue.offer(events, {
                type: "turn.terminal",
                driver,
                providerThreadId: input.providerThread.id,
                providerTurnId,
                runOrdinal: input.runOrdinal,
                status: "interrupted",
                failure: null,
                threadDisposition: "reusable",
              });
            }),
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
          rollbackThread: () => Effect.die("unused rollbackThread"),
          forkThread: () => Effect.die("unused forkThread"),
        };
      }),
  };
}

const timestamp = "2026-10-04T12:00:00.000Z";

const agent: TaskAgent = {
  id: TaskAgentId.make("task-agent:v2-slice"),
  projectId: null,
  name: "Slice agent",
  enabled: true,
  startStatuses: ["To Do"],
  startTags: [],
  startRunStatuses: [],
  config: {
    role: "Developer",
    modelSelection: agentModel,
    runtimeMode: "full-access",
    instructions: "SLICE-AGENT-INSTRUCTIONS: work on the task.",
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const task: Task = {
  id: TaskId.make("task:v2-slice"),
  rank: "0000000000100000" as Task["rank"],
  projectId,
  title: "Prove tasks on v2",
  description: "Reply with a task_agent_result.",
  output: null,
  status: "To Do",
  priority: null,
  createdBy: "user",
  assigneeAgentRunId: null,
  sourceThreadId: null,
  sourceRunId: null,
  rootThreadId: null,
  parentTaskId: null,
  parentRunId: null,
  metadata: null,
  tags: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  notBefore: null,
  triggerChangedAt: timestamp,
};

const TASKS_PRODUCT = composeExperimentalServerFeatures([TASKS_SERVER_FEATURE]);

/**
 * Upstream's v2 runtime with a scripted provider, plus the tasks feature
 * composed through the product seam: the hooks core reads for its runtime
 * services and its MCP server, with the product provided as the CLI does.
 */
function makeLayer(name: string, cwd: string, started: Ref.Ref<ReadonlyArray<StartedTurn>>) {
  const db = SqlitePersistenceMemory;
  const runtime = makeOrchestratorV2ReplayLayerWithRegistry(
    { name, runtimePolicyOverride: { cwd } },
    ProviderAdapterRegistry.makeSingleLayer(makeTaskAgentAdapter(started)),
    { databaseLayer: db },
  );
  const core = Layer.mergeAll(ThreadManagementService.layer, ProjectStore.layer).pipe(
    Layer.provideMerge(runtime),
    Layer.provideMerge(db),
    Layer.provideMerge(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) })),
    Layer.provideMerge(ServerSettings.layerTest().pipe(Layer.orDie)),
    Layer.provideMerge(NodeServices.layer),
  );
  const composed = productMcpToolsLayer.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(productFeatureLayer),
    Layer.provideMerge(core),
    Layer.provide(Layer.succeed(ServerProduct, TASKS_PRODUCT)),
  );
  // Feature services are erased at the product boundary; the tests read them.
  return composed as Layer.Layer<
    Layer.Success<typeof composed> | TaskRepository | TaskAgentService | TaskSourceWake,
    Layer.Error<typeof composed>
  >;
}

/** Polls stored state until it is Some; the service settles runs asynchronously. */
const eventually = <A, E, R>(label: string, read: Effect.Effect<Option.Option<A>, E, R>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const value = yield* read;
      if (Option.isSome(value)) return value.value;
      yield* Effect.sleep("20 millis");
    }
    return yield* Effect.die(`Timed out waiting for ${label}.`);
  });

let personMessages = 0;

const slice = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const taskAgents = yield* TaskAgentService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const runsOf = repository.searchAgentRuns({ taskId: task.id, limit: 10 });
  const runWithStatus = (id: string, status: string) =>
    runsOf.pipe(
      Effect.map((runs) =>
        Option.fromNullishOr(runs.find((run) => run.id === id && run.status === status)),
      ),
    );
  const v2Runs = (threadId: ThreadId) =>
    threads
      .getThreadRecords(threadId, ["runs"])
      .pipe(
        Effect.map((records) =>
          records.runs.toSorted(
            (left: OrchestrationV2Run, right: OrchestrationV2Run) => left.ordinal - right.ordinal,
          ),
        ),
      );
  /**
   * Creates the agent and a task in its start status, and waits for the run to
   * start. The description reaches the run's first turn, so it can carry a marker.
   */
  const createTaskWith = (description: string) =>
    Effect.gen(function* () {
      yield* repository.upsertAgent(agent);
      const created = yield* repository.upsert({ ...task, description });
      yield* taskAgents.scheduleTaskChanged({ task: created, reason: "created" });
      return yield* eventually(
        "the first run to start",
        runsOf.pipe(Effect.map((runs) => Option.fromNullishOr(runs[0]))),
      );
    });
  const createTask = createTaskWith(task.description);
  /** A message a person types into the thread, as the web client sends it. */
  const sendAsPerson = (threadId: ThreadId, text: string, mode: "auto" | "queue" = "auto") =>
    Effect.gen(function* () {
      personMessages += 1;
      const id = `${threadId}:${personMessages}`;
      return yield* threads.sendToThread({
        projectId,
        commandId: CommandId.make(`command:person:${id}`),
        threadId,
        messageId: MessageId.make(`message:person:${id}`),
        text,
        attachments: [],
        mode,
        createdBy: "user",
        creationSource: "web",
      });
    });
  return {
    repository,
    taskAgents,
    threads,
    runsOf,
    runWithStatus,
    v2Runs,
    createTask,
    createTaskWith,
    sendAsPerson,
  };
});

const runSlice = <A, E>(
  name: string,
  body: (
    services: Effect.Success<typeof slice> & {
      readonly started: Ref.Ref<ReadonlyArray<StartedTurn>>;
      readonly cwd: string;
    },
  ) => Effect.Effect<
    A,
    E,
    | TaskRepository
    | TaskAgentService
    | TaskSourceWake
    | SqlClient.SqlClient
    | McpServer.McpServer
    | ProjectStore.ProjectStoreV2
    | ThreadManagementService.ThreadManagementService
  >,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(name);
      const started = yield* Ref.make<ReadonlyArray<StartedTurn>>([]);
      return yield* Effect.gen(function* () {
        const services = yield* slice;
        return yield* body({ ...services, started, cwd });
      }).pipe(Effect.provide(makeLayer(name, cwd, started)));
    }),
  );

it.live(
  "creating a task in an agent's start status starts a run on a new v2 thread with the agent's model and instructions",
  () =>
    runSlice("task-agent-v2-start", ({ createTask, threads, started, cwd }) =>
      Effect.gen(function* () {
        const run = yield* createTask;
        assert.strictEqual(run.agentId, agent.id);
        assert.deepStrictEqual(run.modelSelection, agentModel);
        const thread = yield* eventually(
          "the v2 thread",
          threads.getThreadRecords(run.threadId, ["runs"]).pipe(Effect.option),
        );
        assert.strictEqual(thread.thread.projectId, projectId);
        assert.strictEqual(thread.thread.title, `${agent.name}: ${task.title}`);
        assert.strictEqual(thread.thread.modelSelection.model, agentModel.model);
        assert.strictEqual(thread.thread.runtimeMode, "full-access");
        assert.strictEqual(thread.thread.createdBy, "agent");
        // Run threads stay out of thread lists but keep a shell, so they open by link.
        assert.strictEqual(thread.thread.sidebarHidden, true);
        const shell = yield* threads.getThreadShell(run.threadId);
        assert.strictEqual(shell?.sidebarHidden, true);
        const firstTurn = yield* eventually(
          "the provider turn",
          Ref.get(started).pipe(Effect.map((turns) => Option.fromNullishOr(turns[0]))),
        );
        assert.strictEqual(firstTurn.threadId, run.threadId);
        assert.strictEqual(firstTurn.model, agentModel.model);
        assert.strictEqual(firstTurn.cwd, cwd);
        assert.include(firstTurn.text, "SLICE-AGENT-INSTRUCTIONS");
        assert.include(firstTurn.text, `- id: ${task.id}`);
        assert.include(firstTurn.text, `agentRunId: ${run.id}`);
      }),
    ),
);

it.live("the run completes from its final message's task_agent_result", () =>
  runSlice("task-agent-v2-finish", ({ createTask, runWithStatus, repository, threads }) =>
    Effect.gen(function* () {
      const run = yield* createTask;
      const done = yield* eventually("the run to complete", runWithStatus(run.id, "completed"));
      assert.isNotNull(done.completedAt);
      const thread = yield* threads.getThreadRecords(run.threadId, ["runs", "messages"]);
      assert.deepStrictEqual(
        thread.runs.map((v2Run) => v2Run.status),
        ["completed"],
      );
      const finalReply = thread.messages.findLast((message) => message.role === "assistant");
      assert.include(finalReply?.text ?? "", "task_agent_result");
      const updated = Option.getOrThrow(yield* repository.getById({ id: task.id }));
      assert.strictEqual(updated.status, "Needs Review");
      assert.strictEqual(updated.output, "Handled 1");
      assert.isNull(updated.assigneeAgentRunId);
    }),
  ),
);

it.live("agent_run_message on an ended run continues the same v2 thread as a new run", () =>
  runSlice(
    "task-agent-v2-continue",
    ({ createTask, runWithStatus, repository, taskAgents, v2Runs, started }) =>
      Effect.gen(function* () {
        const first = yield* createTask;
        yield* eventually("the first run to complete", runWithStatus(first.id, "completed"));
        const message = yield* taskAgents.messageRun({ id: first.id, text: "Please continue." });
        assert.isTrue(message.ok);
        if (!message.ok) return;
        assert.isTrue(message.continued);
        assert.notStrictEqual(message.run.id, first.id);
        assert.strictEqual(message.run.threadId, first.threadId);
        assert.strictEqual(message.run.continuesRunId, first.id);
        yield* eventually(
          "the continuation to complete",
          runWithStatus(message.run.id, "completed"),
        );
        assert.deepStrictEqual(
          (yield* v2Runs(first.threadId)).map((run) => run.status),
          ["completed", "completed"],
        );
        const turns = yield* Ref.get(started);
        assert.lengthOf(turns, 2);
        assert.strictEqual(turns[1]?.threadId, first.threadId);
        assert.include(turns[1]?.text ?? "", `agentRunId: ${message.run.id}`);
        assert.include(turns[1]?.text ?? "", "Please continue.");
        const updated = Option.getOrThrow(yield* repository.getById({ id: task.id }));
        assert.strictEqual(updated.output, "Handled 2");
      }),
  ),
);

it.live("stopping an active run interrupts its v2 run and records it as stopped", () =>
  runSlice("task-agent-v2-stop", ({ createTask, runWithStatus, taskAgents, v2Runs }) =>
    Effect.gen(function* () {
      const first = yield* createTask;
      yield* eventually("the first run to complete", runWithStatus(first.id, "completed"));
      const holding = yield* taskAgents.messageRun({
        id: first.id,
        text: `Keep working. ${HOLD}`,
      });
      assert.isTrue(holding.ok);
      if (!holding.ok) return;
      const v2RunWithStatus = (status: OrchestrationV2Run["status"]) =>
        v2Runs(first.threadId).pipe(
          Effect.map((runs) =>
            Option.fromNullishOr(runs.find((run) => run.ordinal === 2 && run.status === status)),
          ),
        );
      yield* eventually("the held v2 run to be running", v2RunWithStatus("running"));
      const stopped = yield* taskAgents.stopRun({ id: holding.run.id });
      assert.strictEqual(Option.getOrThrow(stopped).status, "stopped");
      assert.isNotNull(Option.getOrThrow(stopped).completedAt);
      yield* eventually("the held v2 run to be interrupted", v2RunWithStatus("interrupted"));
      const sql = yield* SqlClient.SqlClient;
      const stopEvents = yield* sql<{ readonly payload_json: string }>`
        SELECT payload_json FROM task_events
        WHERE task_id = ${task.id} AND kind = 'task.agent-stopped'
      `;
      assert.lengthOf(stopEvents, 1);
      assert.include(stopEvents[0]?.payload_json ?? "", "stop-requested");
    }),
  ),
);

it.live("a person's message in a failed run's thread continues it as a new run", () =>
  runSlice(
    "task-agent-v2-person-continue",
    ({ createTaskWith, runWithStatus, runsOf, repository, v2Runs, started, sendAsPerson }) =>
      Effect.gen(function* () {
        const first = yield* createTaskWith(`Fail the first turn. ${FAIL}`);
        yield* eventually("the first run to fail", runWithStatus(first.id, "failed"));
        yield* sendAsPerson(first.threadId, "continue");
        const continuation = yield* eventually(
          "the continuation to complete",
          runsOf.pipe(
            Effect.map((runs) =>
              Option.fromNullishOr(
                runs.find((run) => run.continuesRunId === first.id && run.status === "completed"),
              ),
            ),
          ),
        );
        assert.strictEqual(continuation.threadId, first.threadId);
        assert.strictEqual(continuation.agentId, agent.id);
        assert.lengthOf(yield* runsOf, 2);
        assert.deepStrictEqual(
          (yield* v2Runs(first.threadId)).map((run) => run.status),
          ["failed", "completed"],
        );
        // The person's message is the continuation's turn; nothing else is sent.
        const turns = yield* Ref.get(started);
        assert.deepStrictEqual(
          turns.map((turn) => turn.text.includes(FAIL) || turn.text),
          [true, "continue"],
        );
        const updated = Option.getOrThrow(yield* repository.getById({ id: task.id }));
        assert.strictEqual(updated.status, "Needs Review");
        assert.strictEqual(updated.output, "Handled 2");
        const sql = yield* SqlClient.SqlClient;
        const results = yield* sql<{ readonly payload_json: string }>`
          SELECT payload_json FROM task_events
          WHERE task_id = ${task.id} AND kind = 'task.agent-result'
        `;
        assert.lengthOf(results, 1);
        assert.include(results[0]?.payload_json ?? "", continuation.id);
      }),
  ),
);

it.live("a person's message to an active run's thread goes to that run without a new run", () =>
  runSlice(
    "task-agent-v2-person-active",
    ({
      createTaskWith,
      runWithStatus,
      runsOf,
      repository,
      threads,
      v2Runs,
      sendAsPerson,
      started,
    }) =>
      Effect.gen(function* () {
        const first = yield* createTaskWith(`Keep working. ${HOLD}`);
        yield* eventually(
          "the held provider turn",
          Ref.get(started).pipe(Effect.map((turns) => Option.fromNullishOr(turns[0]))),
        );
        // Queued behind the held turn, so it starts a v2 run of its own.
        yield* sendAsPerson(first.threadId, "Also do this.", "queue");
        yield* threads.interruptThread({
          projectId,
          commandId: CommandId.make("command:person-active:interrupt"),
          threadId: first.threadId,
          reason: "Let the queued message run.",
        });
        // The run owns the person's turn and finishes with its result.
        yield* eventually("the run to complete", runWithStatus(first.id, "completed"));
        assert.lengthOf(yield* runsOf, 1);
        assert.deepStrictEqual(
          (yield* v2Runs(first.threadId)).map((run) => run.status),
          ["interrupted", "completed"],
        );
        const updated = Option.getOrThrow(yield* repository.getById({ id: task.id }));
        assert.strictEqual(updated.output, "Handled 2");
      }),
  ),
);

it.live(
  "a person's message on a closed task or with the agent disabled stays a plain turn until reopened",
  () =>
    runSlice(
      "task-agent-v2-person-refused",
      ({ createTaskWith, runWithStatus, runsOf, repository, v2Runs, sendAsPerson }) =>
        Effect.gen(function* () {
          const first = yield* createTaskWith(`Fail the first turn. ${FAIL}`);
          yield* eventually("the first run to fail", runWithStatus(first.id, "failed"));
          const v2RunCompleted = (ordinal: number) =>
            v2Runs(first.threadId).pipe(
              Effect.map((runs) =>
                Option.fromNullishOr(
                  runs.find((run) => run.ordinal === ordinal && run.status === "completed"),
                ),
              ),
            );

          const person = { type: "person" } as const;
          yield* repository.setArchived({ ids: [task.id], archived: true, actor: person });
          yield* sendAsPerson(first.threadId, "Archived task: just answer.");
          yield* eventually("the archived-task turn to complete", v2RunCompleted(2));

          yield* repository.setArchived({ ids: [task.id], archived: false, actor: person });
          yield* repository.upsertAgent({ ...agent, enabled: false });
          yield* sendAsPerson(first.threadId, "Disabled agent: just answer.");
          yield* eventually("the disabled-agent turn to complete", v2RunCompleted(3));

          // v2 events are handled in order: once this message's continuation
          // exists, the two earlier messages were handled without one.
          yield* repository.upsertAgent(agent);
          yield* sendAsPerson(first.threadId, "continue");
          const continuation = yield* eventually(
            "the continuation to complete",
            runsOf.pipe(
              Effect.map((runs) =>
                Option.fromNullishOr(runs.find((run) => run.status === "completed")),
              ),
            ),
          );
          assert.strictEqual(continuation.continuesRunId, first.id);
          assert.lengthOf(yield* runsOf, 2);
          assert.deepStrictEqual(
            (yield* v2Runs(first.threadId)).map((run) => run.status),
            ["failed", "completed", "completed", "completed"],
          );
        }),
    ),
);

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "task-agent-v2", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "task-agent-v2", version: "1" },
  },
  getClient: Effect.die("unused"),
});

it.live("a chat creates a task through the task MCP tools and the started run reports back", () =>
  runSlice("task-agent-v2-mcp", ({ repository, threads, cwd }) =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const projectStore = yield* ProjectStore.ProjectStoreV2;
      const toolNames = new Set(server.tools.map(({ tool }) => tool.name));
      for (const name of ["task_create", "task_get", "agent_run_message", "agent_run_stop"]) {
        assert.isTrue(toolNames.has(name), `${name} is registered`);
      }
      yield* projectStore.apply({
        sequence: 1,
        eventId: EventId.make("event:task-agents-v2:project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: timestamp,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId,
          title: "Task agents",
          workspaceRoot: cwd,
          defaultModelSelection: null,
          scripts: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      const chatThreadId = ThreadIdBrand.make("thread:task-agents-v2:chat");
      yield* threads.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("command:task-agents-v2:chat"),
        threadId: chatThreadId,
        projectId,
        title: "Chat",
        modelSelection: agentModel,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      yield* repository.upsertAgent(agent);
      const callTool = (name: string, args: Record<string, unknown>) =>
        server.callTool({ name, arguments: args }).pipe(
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("environment:task-agents-v2"),
            requestNamespace: "session:task-agents-v2",
            thread: {
              threadId: chatThreadId,
              providerSessionId: "session:task-agents-v2",
              providerInstanceId: instanceId,
            },
            client: undefined,
            capabilities: new Set<never>(),
            issuedAt: 0,
          }),
          Effect.provideService(McpSchema.McpServerClient, mcpClient),
        );
      const textOf = (result: McpSchema.CallToolResult) =>
        result.content.map((part) => (part.type === "text" ? part.text : "")).join("");

      const created = yield* callTool("task_create", {
        title: task.title,
        description: task.description,
        status: "To Do",
      });
      assert.isFalse(created.isError, textOf(created));
      const createdTask = JSON.parse(textOf(created)).task;
      assert.strictEqual(createdTask.projectId, projectId);
      assert.strictEqual(createdTask.sourceThreadId, chatThreadId);

      const run = yield* eventually(
        "the run to start",
        repository
          .searchAgentRuns({ taskId: createdTask.id, limit: 1 })
          .pipe(Effect.map((runs) => Option.fromNullishOr(runs[0]))),
      );
      yield* eventually(
        "the run to complete",
        repository
          .searchAgentRuns({ taskId: createdTask.id, limit: 1 })
          .pipe(
            Effect.map((runs) =>
              Option.fromNullishOr(runs.find((candidate) => candidate.status === "completed")),
            ),
          ),
      );
      const transcript = yield* callTool("agent_run_transcript", { runId: run.id });
      assert.isFalse(transcript.isError, textOf(transcript));
      assert.include(textOf(transcript), "task_agent_result");
      const fetched = yield* callTool("task_get", { id: createdTask.id });
      assert.include(textOf(fetched), "Needs Review");

      // The chat hears about the finished run once, as a queued notification turn.
      const wake = yield* TaskSourceWake;
      const notificationsOf = threads
        .getThreadRecords(chatThreadId, ["messages"])
        .pipe(
          Effect.map((records) =>
            records.messages.filter(
              (message) => message.notification?.source.kind === "task_agent_run",
            ),
          ),
        );
      const [notified] = yield* eventually(
        "the source chat notification",
        Effect.gen(function* () {
          yield* wake.sweep;
          const messages = yield* notificationsOf;
          return messages.length > 0 ? Option.some(messages) : Option.none();
        }),
      );
      yield* wake.sweep;
      assert.lengthOf(yield* notificationsOf, 1);
      assert.strictEqual(notified?.senderThreadId, run.threadId);
      assert.strictEqual(notified?.createdBy, "agent");
      assert.strictEqual(notified?.creationSource, "server");
      assert.deepStrictEqual(notified?.notification, {
        source: {
          kind: "task_agent_run",
          tasks: [{ id: createdTask.id, title: task.title }],
          childThreadId: run.threadId,
        },
        outcome: "completed",
        summary: `Task "${task.title}" completed`,
      });
      assert.include(notified?.text, "Summary: Handled 1");
      // The queue delivers it as a turn of its own once the chat is idle.
      yield* eventually(
        "the notification turn",
        threads
          .getThreadRecords(chatThreadId, ["runs"])
          .pipe(
            Effect.map((records) =>
              Option.fromNullishOr(
                records.runs.find((candidate) => candidate.userMessageId === notified?.id),
              ),
            ),
          ),
      );
    }),
  ),
);

it.live("a run a person's message continued claims the task with the earlier run's id", () =>
  runSlice(
    "task-agent-v2-person-claim",
    ({ createTaskWith, runWithStatus, runsOf, repository, taskAgents, sendAsPerson, started }) =>
      Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        const first = yield* createTaskWith(`Fail the first turn. ${FAIL}`);
        yield* eventually("the first run to fail", runWithStatus(first.id, "failed"));
        yield* sendAsPerson(first.threadId, `continue ${HOLD}`);
        const continuation = yield* eventually(
          "the continuation to start",
          runsOf.pipe(
            Effect.map((runs) =>
              Option.fromNullishOr(runs.find((run) => run.continuesRunId === first.id)),
            ),
          ),
        );
        yield* eventually(
          "the held provider turn",
          Ref.get(started).pipe(Effect.map((turns) => Option.fromNullishOr(turns[1]))),
        );
        // The agent was only told the first run's id; claiming with it must not
        // release the continuation.
        const claimed = yield* server
          .callTool({
            name: "task_update",
            arguments: { id: task.id, assigneeAgentRunId: first.id },
          })
          .pipe(
            Effect.provideService(McpInvocationContext, {
              environmentId: EnvironmentId.make("environment:task-agents-v2"),
              requestNamespace: "session:task-agents-v2",
              thread: {
                threadId: first.threadId,
                providerSessionId: "session:task-agents-v2",
                providerInstanceId: instanceId,
              },
              client: undefined,
              capabilities: new Set<never>(),
              issuedAt: 0,
            }),
            Effect.provideService(McpSchema.McpServerClient, mcpClient),
          );
        assert.isFalse(claimed.isError);
        const updated = Option.getOrThrow(yield* repository.getById({ id: task.id }));
        assert.strictEqual(updated.assigneeAgentRunId, continuation.id);
        const stopped = yield* taskAgents.stopRun({ id: continuation.id });
        assert.strictEqual(Option.getOrThrow(stopped).status, "stopped");
      }),
  ),
);

/** Calls a task tool as the provider session of `threadId`. */
const callTaskTool = (threadId: ThreadId, name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({ name, arguments: args }).pipe(
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:task-agents-v2"),
        requestNamespace: "session:task-agents-v2",
        thread: {
          threadId,
          providerSessionId: "session:task-agents-v2",
          providerInstanceId: instanceId,
        },
        client: undefined,
        capabilities: new Set<never>(),
        issuedAt: 0,
      }),
      Effect.provideService(McpSchema.McpServerClient, mcpClient),
    );
    return {
      isError: result.isError === true,
      text: result.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
    };
  });

it.live("task tools start or continue runs only within the calling thread's modes", () =>
  runSlice(
    "task-agent-v2-escalation",
    ({ createTask, runWithStatus, runsOf, repository, threads, started, sendAsPerson }) =>
      Effect.gen(function* () {
        const first = yield* createTask;
        yield* eventually("the first run to complete", runWithStatus(first.id, "completed"));
        const createChat = (id: string, runtimeMode: "approval-required" | "full-access") =>
          Effect.gen(function* () {
            const threadId = ThreadIdBrand.make(id);
            yield* threads.dispatch({
              type: "thread.create",
              createdBy: "user",
              creationSource: "web",
              commandId: CommandId.make(`command:${id}`),
              threadId,
              projectId,
              title: "Chat",
              modelSelection: agentModel,
              runtimeMode,
              interactionMode: "default",
              branch: null,
              worktreePath: null,
            });
            return threadId;
          });
        /** Holds a turn open in the chat, so its provider session is live. */
        const goLive = (threadId: ThreadId) =>
          Effect.gen(function* () {
            yield* sendAsPerson(threadId, `Work on something. ${HOLD}`);
            yield* eventually(
              "the chat's held turn",
              Ref.get(started).pipe(
                Effect.map((turns) =>
                  Option.fromNullishOr(turns.find((turn) => turn.threadId === threadId)),
                ),
              ),
            );
          });

        // A Supervised chat without a live run.
        const supervised = yield* createChat("thread:escalation:supervised", "approval-required");
        const idle = yield* callTaskTool(supervised, "agent_run_message", {
          runId: first.id,
          text: "Do something with full access.",
        });
        assert.isTrue(idle.isError, idle.text);
        assert.include(idle.text, "needs an active run");

        // Live, but the full-access run is broader than the chat.
        yield* goLive(supervised);
        const live = yield* callTaskTool(supervised, "agent_run_message", {
          runId: first.id,
          text: "Do something with full access.",
        });
        assert.isTrue(live.isError, live.text);
        assert.include(live.text, "broader than this thread's approval-required mode");
        assert.lengthOf(yield* runsOf, 1);

        // Agent writes that start runs are held to the same ceiling.
        const created = yield* callTaskTool(supervised, "agent_create", {
          name: "Escalated",
          projectId: null,
          modelSelection: agentModel,
          runtimeMode: "full-access",
          startStatuses: ["To Do"],
        });
        assert.isTrue(created.isError, created.text);
        assert.include(created.text, "broader than this thread's approval-required mode");
        const updated = yield* callTaskTool(supervised, "agent_update", {
          id: agent.id,
          instructions: "New instructions.",
        });
        assert.isTrue(updated.isError, updated.text);
        assert.include(updated.text, "broader than this thread's approval-required mode");
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getAgentById({ id: agent.id })).config.instructions,
          agent.config.instructions,
        );
        // Within the ceiling, or disabled, an agent can still be written.
        const disabled = yield* callTaskTool(supervised, "agent_create", {
          name: "Drafted",
          projectId: null,
          modelSelection: agentModel,
          runtimeMode: "full-access",
          enabled: false,
        });
        assert.isFalse(disabled.isError, disabled.text);
        const narrow = yield* callTaskTool(supervised, "agent_create", {
          name: "Narrow",
          projectId: null,
          modelSelection: agentModel,
          runtimeMode: "approval-required",
        });
        assert.isFalse(narrow.isError, narrow.text);

        // A live full-access chat may continue the run.
        const fullAccess = yield* createChat("thread:escalation:full-access", "full-access");
        yield* goLive(fullAccess);
        const continued = yield* callTaskTool(fullAccess, "agent_run_message", {
          runId: first.id,
          text: "Please continue.",
        });
        assert.isFalse(continued.isError, continued.text);
        assert.isTrue(JSON.parse(continued.text).continued);
      }),
  ),
);

/** The tasks RPC group as the WebSocket server serves it: with core's scope middleware. */
const servedTasksGroup = TasksRpcGroup.middleware(RpcScopeAuthorization);
const tasksRpcClient = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  RpcTest.makeClient(servedTasksGroup).pipe(
    Effect.provide(
      Layer.mergeAll(
        rpcContributionHandlersLayer(TASKS_PRODUCT.rpc, {
          currentSessionId: AuthSessionId.make("session:task-agents-v2"),
        }) as Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof TasksRpcGroup>>>,
        rpcScopeAuthorizationLayer(scopes, rpcContributionScopes(TASKS_PRODUCT.rpc)),
      ),
    ),
  );

it.live(
  "the composed tasks feature migrates, lists its MCP tools and runs a task created over RPC",
  () =>
    runSlice("task-agent-v2-seam", ({ repository }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const tables = new Set(
          (yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table'
        `).map((row) => row.name),
        );
        for (const table of ["tasks", "task_agents", "task_agent_runs", "task_automations"]) {
          assert.isTrue(tables.has(table), `${table} exists`);
        }
        const ledger = yield* sql<{ readonly version: number }>`
        SELECT version FROM feature_migration_history WHERE namespace = 'upcomputer.tasks'
      `;
        assert.lengthOf(ledger, TASK_MIGRATION_CONTRIBUTION.migrations.length);

        const server = yield* McpServer.McpServer;
        assert.deepStrictEqual(
          new Set(server.tools.map(({ tool }) => tool.name)),
          new Set(TASK_TOOL_SPECS.map((spec) => spec.name)),
        );

        yield* repository.upsertAgent(agent);
        const input = {
          projectId,
          title: task.title,
          description: task.description,
          status: "To Do",
        };
        const reader = yield* tasksRpcClient([AuthOrchestrationReadScope]);
        const denied = yield* reader[TASKS_RPC_METHODS.create](input).pipe(Effect.flip);
        assert.strictEqual(denied._tag, "EnvironmentAuthorizationError");

        const operator = yield* tasksRpcClient([
          AuthOrchestrationReadScope,
          AuthOrchestrationOperateScope,
        ]);
        const created = yield* operator[TASKS_RPC_METHODS.create](input);
        const runOf = (status?: string) =>
          repository
            .searchAgentRuns({ taskId: created.id, limit: 1 })
            .pipe(
              Effect.map((runs) =>
                Option.fromNullishOr(
                  runs.find((run) => status === undefined || run.status === status),
                ),
              ),
            );
        const run = yield* eventually("the run to start", runOf());
        assert.strictEqual(run.agentId, agent.id);
        yield* eventually("the run to complete", runOf("completed"));
        const fetched = yield* reader[TASKS_RPC_METHODS.get]({ id: created.id });
        assert.strictEqual(fetched?.status, "Needs Review");
      }).pipe(Effect.scoped),
    ),
);
