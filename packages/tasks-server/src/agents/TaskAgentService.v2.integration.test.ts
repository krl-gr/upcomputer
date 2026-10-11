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
import { limitRecoveryCommand } from "../../../../apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts";
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
import { SOURCE_SETTLE_MS, TaskSourceWake } from "./TaskSourceWake.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-task-agent-test");
const agentModel = { instanceId, model: "task-agent-model" } satisfies ModelSelection;
const projectId = ProjectId.make("project:task-agents-v2");

/** A message containing this marker keeps its turn running until it is interrupted. */
const HOLD = "[hold-turn]";
/** A message containing this marker fails its turn. */
const FAIL = "[fail-turn]";
/** A message containing this marker fails its turn on a provider usage limit that resets 2 s later. */
const LIMIT = "[limit-turn]";
/** A message containing this marker leaves native background work running after its turn. */
const BACKGROUND = "[background]";

/** Provider sessions the scripted provider opened, closed and resumed threads in. */
interface SessionLog {
  readonly opened: number;
  readonly closed: number;
  readonly resumed: number;
}

/** One provider process per thread, like OpenCode 1.x: detaching its thread stops it. */
const perThreadCapabilities = {
  ...CodexProviderCapabilitiesV2,
  sessions: {
    ...CodexProviderCapabilitiesV2.sessions,
    supportsMultipleProviderThreadsPerSession: false,
  },
};

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
  sessions: Ref.Ref<SessionLog>,
  perThreadSessions: boolean,
  background: Ref.Ref<boolean>,
): ProviderAdapterV2Shape {
  const capabilities = perThreadSessions ? perThreadCapabilities : CodexProviderCapabilitiesV2;
  return {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (sessionInput) =>
      Effect.gen(function* () {
        yield* Ref.update(sessions, (log) => ({ ...log, opened: log.opened + 1 }));
        yield* Effect.addFinalizer(() =>
          Ref.update(sessions, (log) => ({ ...log, closed: log.closed + 1 })),
        );
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
            capabilities,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          // Native background work only the provider knows about, like Claude's background Bash.
          hasPendingBackgroundWork: Ref.get(background),
          hasPendingBackgroundWorkForThread: () => Ref.get(background),
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
          resumeThread: ({ providerThread }) =>
            Ref.update(sessions, (log) => ({ ...log, resumed: log.resumed + 1 })).pipe(
              Effect.as(providerThread),
            ),
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
              if (input.message.text.includes(BACKGROUND)) yield* Ref.set(background, true);
              yield* Queue.offer(events, providerTurn(input, id, "running", at));
              if (input.message.text.includes(HOLD)) {
                held.set(id, input);
                return;
              }
              if (input.message.text.includes(LIMIT)) {
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
                    class: "usage_limit",
                    message: "Plan limit reached.",
                    code: "usageLimitExceeded",
                    retryable: null,
                    resetAt: DateTime.formatIso(DateTime.add(at, { seconds: 2 })),
                  },
                  threadDisposition: "reusable",
                });
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

interface SliceOptions {
  readonly perThreadSessions?: boolean;
  readonly providerSessionIdleTimeoutMs?: number;
}

/**
 * Upstream's v2 runtime with a scripted provider, plus the tasks feature
 * composed through the product seam: the hooks core reads for its runtime
 * services and its MCP server, with the product provided as the CLI does.
 */
function makeLayer(
  name: string,
  cwd: string,
  started: Ref.Ref<ReadonlyArray<StartedTurn>>,
  sessions: Ref.Ref<SessionLog>,
  background: Ref.Ref<boolean>,
  options: SliceOptions,
) {
  const db = SqlitePersistenceMemory;
  const runtime = makeOrchestratorV2ReplayLayerWithRegistry(
    { name, runtimePolicyOverride: { cwd } },
    ProviderAdapterRegistry.makeSingleLayer(
      makeTaskAgentAdapter(started, sessions, options.perThreadSessions ?? false, background),
    ),
    {
      databaseLayer: db,
      ...(options.providerSessionIdleTimeoutMs === undefined
        ? {}
        : { providerSessionIdleTimeoutMs: options.providerSessionIdleTimeoutMs }),
    },
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
      readonly sessions: Ref.Ref<SessionLog>;
      readonly background: Ref.Ref<boolean>;
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
  options: SliceOptions = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(name);
      const started = yield* Ref.make<ReadonlyArray<StartedTurn>>([]);
      const sessions = yield* Ref.make<SessionLog>({ opened: 0, closed: 0, resumed: 0 });
      const background = yield* Ref.make(false);
      return yield* Effect.gen(function* () {
        const services = yield* slice;
        return yield* body({ ...services, started, sessions, background, cwd });
      }).pipe(Effect.provide(makeLayer(name, cwd, started, sessions, background, options)));
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

it.live("a started run holds its task and ends when its final update releases it", () =>
  runSlice("task-agent-v2-claim", ({ repository, taskAgents, runsOf, runWithStatus, started }) =>
    Effect.gen(function* () {
      yield* repository.upsertAgent(agent);
      const created = yield* repository.upsert({
        ...task,
        description: `Address the review. ${HOLD}`,
        output: "Reviewer: the README example is wrong.",
      });
      yield* taskAgents.scheduleTaskChanged({ task: created, reason: "created" });
      const run = yield* eventually(
        "the run to start",
        runsOf.pipe(Effect.map((runs) => Option.fromNullishOr(runs[0]))),
      );
      const claimed = Option.getOrThrow(yield* repository.getById({ id: task.id }));
      assert.strictEqual(claimed.assigneeAgentRunId, run.id);
      // The prompt carries what the agent would otherwise fetch with task_get.
      const firstTurn = yield* eventually(
        "the provider turn",
        Ref.get(started).pipe(Effect.map((turns) => Option.fromNullishOr(turns[0]))),
      );
      assert.include(
        firstTurn.text,
        `This run holds the task: the server set assigneeAgentRunId to "${run.id}"`,
      );
      assert.include(firstTurn.text, "Current output:\nReviewer: the README example is wrong.");
      assert.notInclude(firstTurn.text, "Claim the task by setting");

      const released = yield* callTaskTool(run.threadId, "task_update", {
        id: task.id,
        status: "Needs Review",
        assigneeAgentRunId: null,
      });
      assert.isFalse(released.isError, released.text);
      const done = yield* eventually("the run to complete", runWithStatus(run.id, "completed"));
      assert.isNotNull(done.completedAt);
      const updated = Option.getOrThrow(yield* repository.getById({ id: task.id }));
      assert.strictEqual(updated.status, "Needs Review");
      assert.isNull(updated.assigneeAgentRunId);
    }),
  ),
);

it.live("a run that releases its task as Blocked ends blocked and wakes its chat at once", () =>
  runSlice("task-agent-v2-blocked-release", ({ repository, taskAgents, runsOf, threads, cwd }) =>
    Effect.gen(function* () {
      const projectStore = yield* ProjectStore.ProjectStoreV2;
      yield* projectStore.apply({
        sequence: 1,
        eventId: EventId.make("event:task-agents-v2-blocked:project"),
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
      const chatThreadId = ThreadIdBrand.make("thread:task-agents-v2-blocked:chat");
      yield* threads.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("command:task-agents-v2-blocked:chat"),
        threadId: chatThreadId,
        projectId,
        title: "Chat",
        modelSelection: agentModel,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      const helper: TaskAgent = {
        ...agent,
        id: TaskAgentId.make("task-agent:v2-blocked-helper"),
        name: "Blocked helper",
        startStatuses: [],
        startRunStatuses: ["blocked"],
      };
      yield* repository.upsertAgent(agent);
      yield* repository.upsertAgent(helper);
      const created = yield* repository.upsert({
        ...task,
        description: `Needs credentials. ${HOLD}`,
        sourceThreadId: chatThreadId,
      });
      yield* taskAgents.scheduleTaskChanged({ task: created, reason: "created" });
      const run = yield* eventually(
        "the run to start",
        runsOf.pipe(Effect.map((runs) => Option.fromNullishOr(runs[0]))),
      );

      const released = yield* callTaskTool(run.threadId, "task_update", {
        id: task.id,
        status: "Blocked",
        output: "Missing required credentials. Need user input.",
        assigneeAgentRunId: null,
      });
      assert.isFalse(released.isError, released.text);
      const ended = yield* eventually(
        "the run to end",
        runsOf.pipe(
          Effect.map((runs) =>
            Option.fromNullishOr(
              runs.find((candidate) => candidate.id === run.id && candidate.completedAt),
            ),
          ),
        ),
      );
      assert.strictEqual(ended.status, "blocked");
      const { events } = yield* repository.events({
        taskId: task.id,
        kinds: ["task.agent-result"],
      });
      assert.lengthOf(events, 1);
      assert.include(events[0]?.payload, { blocked: true, agentRunId: run.id });
      const helperRun = yield* eventually(
        "the blocked-run agent to start",
        runsOf.pipe(
          Effect.map((runs) =>
            Option.fromNullishOr(runs.find((candidate) => candidate.agentId === helper.id)),
          ),
        ),
      );
      assert.strictEqual(helperRun.triggerRunId, run.id);

      // No settle wait: the chat hears at once, while the helper still runs.
      const wake = yield* TaskSourceWake;
      yield* wake.sweep;
      const records = yield* threads.getThreadRecords(chatThreadId, ["messages"]);
      const notified = records.messages.filter(
        (message) => message.notification?.source.kind === "task_agent_run",
      );
      assert.lengthOf(notified, 1);
      assert.strictEqual(notified[0]?.notification?.summary, `Task "${task.title}" is blocked`);
      assert.include(notified[0]?.text, `run ${run.id}`);
      assert.include(notified[0]?.text, "Summary: Missing required credentials. Need user input.");
      assert.notInclude(notified[0]?.text, "No run for this chat's tasks is in progress now.");
    }),
  ),
);

it.live("a Blocked release starts only blocked-run agents within the releasing run's modes", () =>
  runSlice("task-agent-v2-blocked-ceiling", ({ repository, taskAgents, runsOf }) =>
    Effect.gen(function* () {
      const supervised: TaskAgent = {
        ...agent,
        config: { ...agent.config, runtimeMode: "approval-required" },
      };
      const broadHelper: TaskAgent = {
        ...agent,
        id: TaskAgentId.make("task-agent:v2-blocked-broad"),
        name: "Full-access helper",
        startStatuses: [],
        startRunStatuses: ["blocked"],
      };
      const narrowHelper: TaskAgent = {
        ...supervised,
        id: TaskAgentId.make("task-agent:v2-blocked-narrow"),
        name: "Supervised helper",
        startStatuses: [],
        startRunStatuses: ["blocked"],
      };
      yield* repository.upsertAgent(supervised);
      yield* repository.upsertAgent(broadHelper);
      yield* repository.upsertAgent(narrowHelper);
      const created = yield* repository.upsert({ ...task, description: `Work. ${HOLD}` });
      yield* taskAgents.scheduleTaskChanged({ task: created, reason: "created" });
      const run = yield* eventually(
        "the run to start",
        runsOf.pipe(Effect.map((runs) => Option.fromNullishOr(runs[0]))),
      );

      const released = yield* callTaskTool(run.threadId, "task_update", {
        id: task.id,
        status: "Blocked",
        output: "Need user input.",
        assigneeAgentRunId: null,
      });
      assert.isFalse(released.isError, released.text);
      const narrowRun = yield* eventually(
        "the supervised helper to start",
        runsOf.pipe(
          Effect.map((runs) =>
            Option.fromNullishOr(runs.find((candidate) => candidate.agentId === narrowHelper.id)),
          ),
        ),
      );
      assert.strictEqual(narrowRun.triggerRunId, run.id);
      assert.strictEqual(
        (yield* runsOf).find((candidate) => candidate.id === run.id)?.status,
        "blocked",
      );
      // A pass with no caller, as after a restart, is held to the blocked run's modes too.
      yield* taskAgents.recover;
      assert.isUndefined((yield* runsOf).find((candidate) => candidate.agentId === broadHelper.id));
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

/** The session log once `count` sessions closed and none is open. */
const sessionsReleased = (sessions: Ref.Ref<SessionLog>, count: number) =>
  Ref.get(sessions).pipe(
    Effect.map((log) =>
      log.closed === count && log.opened === count ? Option.some(log) : Option.none(),
    ),
  );

it.live(
  "a finished run releases its provider session, and a continuation resumes in a new one",
  () =>
    runSlice(
      "task-agent-v2-release",
      ({ createTask, runWithStatus, taskAgents, threads, started, sessions }) =>
        Effect.gen(function* () {
          const first = yield* createTask;
          yield* eventually("the first run to complete", runWithStatus(first.id, "completed"));
          yield* eventually("the provider session to close", sessionsReleased(sessions, 1));
          const released = yield* threads.getThreadRecords(first.threadId, ["providerSessions"]);
          assert.lengthOf(released.providerSessions, 0);
          // Releasing the session leaves the thread itself as it was.
          assert.isNull(released.thread.settledOverride);

          const message = yield* taskAgents.messageRun({ id: first.id, text: "Please continue." });
          assert.isTrue(message.ok);
          if (!message.ok) return;
          yield* eventually(
            "the continuation to complete",
            runWithStatus(message.run.id, "completed"),
          );
          const turns = yield* Ref.get(started);
          assert.lengthOf(turns, 2);
          assert.include(turns[1]?.text ?? "", "Please continue.");
          const log = yield* eventually(
            "the continuation's session to close",
            sessionsReleased(sessions, 2),
          );
          // The new session resumed the thread's provider conversation.
          assert.strictEqual(log.resumed, 1);
        }),
      { perThreadSessions: true },
    ),
);

it.live("a run that ends on a usage limit releases its session and still resumes at reset", () =>
  runSlice(
    "task-agent-v2-release-limit",
    ({ createTaskWith, runWithStatus, runsOf, threads, started, sessions }) =>
      Effect.gen(function* () {
        const first = yield* createTaskWith(`Hit the provider limit. ${LIMIT}`);
        yield* eventually("the run to fail", runWithStatus(first.id, "failed"));
        yield* eventually("the provider session to close", sessionsReleased(sessions, 1));
        const shell = yield* threads.getThreadShell(first.threadId);
        assert.isDefined(shell);
        if (shell === undefined || shell === null) return;
        assert.strictEqual(shell.lastErrorClass, "usage_limit");
        assert.notStrictEqual(shell.settledOverride, "settled");

        // The usage-limit worker's own steps: arm recovery, then resume at reset.
        const arm = limitRecoveryCommand(shell, true, Date.now());
        assert.strictEqual(arm?.type, "thread.metadata.update");
        yield* threads.dispatch(arm!);
        const armed = yield* threads.getThreadShell(first.threadId);
        assert.strictEqual(armed?.limitRecovery?.autoResume, true);
        const resume = limitRecoveryCommand(armed!, true, Date.parse(armed!.usageLimitResetAt!));
        assert.strictEqual(resume?.type, "message.dispatch");
        // The orchestrator resumes only once the reset time has passed.
        yield* Effect.sleep(Date.parse(armed!.usageLimitResetAt!) - Date.now() + 50);
        yield* threads.dispatch(resume!);
        yield* eventually(
          "the resumed run to complete",
          runsOf.pipe(
            Effect.map((runs) =>
              Option.fromNullishOr(
                runs.find((run) => run.continuesRunId === first.id && run.status === "completed"),
              ),
            ),
          ),
        );
        assert.lengthOf(yield* Ref.get(started), 2);
        yield* eventually("the resumed run's session to close", sessionsReleased(sessions, 2));
      }),
    { perThreadSessions: true },
  ),
);

it.live(
  "releasing a stopped run's session keeps the thread's pin, active state and pull request watch",
  () =>
    runSlice(
      "task-agent-v2-release-kept",
      ({ createTaskWith, taskAgents, threads, v2Runs, sessions }) =>
        Effect.gen(function* () {
          const first = yield* createTaskWith(`Keep working. ${HOLD}`);
          const v2RunWithStatus = (status: OrchestrationV2Run["status"]) =>
            v2Runs(first.threadId).pipe(
              Effect.map((runs) => Option.fromNullishOr(runs.find((run) => run.status === status))),
            );
          yield* eventually("the v2 run to be running", v2RunWithStatus("running"));
          const threadId = first.threadId;
          yield* threads.dispatch({
            type: "thread.pin",
            commandId: CommandId.make("command:release-kept:pin"),
            threadId,
          });
          yield* threads.dispatch({
            type: "thread.unsettle",
            commandId: CommandId.make("command:release-kept:unsettle"),
            threadId,
            reason: "user",
          });
          yield* threads.dispatch({
            type: "thread.pull-request.watch",
            commandId: CommandId.make("command:release-kept:watch"),
            threadId,
            host: "github.com",
            repository: "t3tools/demo",
            number: 7,
            watching: true,
            link: { url: "https://github.com/t3tools/demo/pull/7", source: "manual" },
          });
          const before = (yield* threads.getThreadRecords(threadId, ["runs"])).thread;
          assert.isNotNull(before.pinnedAt ?? null);
          assert.strictEqual(before.settledOverride, "active");
          assert.isDefined(before.pullRequests?.[0]?.watch);

          yield* taskAgents.stopRun({ id: first.id });
          yield* eventually("the v2 run to be interrupted", v2RunWithStatus("interrupted"));
          yield* eventually("the provider session to close", sessionsReleased(sessions, 1));
          const after = (yield* threads.getThreadRecords(threadId, ["runs"])).thread;
          assert.deepStrictEqual(after.pinnedAt, before.pinnedAt);
          assert.strictEqual(after.settledOverride, "active");
          assert.deepStrictEqual(after.pullRequests?.[0]?.watch, before.pullRequests?.[0]?.watch);
        }),
      { perThreadSessions: true },
    ),
);

it.live("a later plain turn in a finished run's thread keeps its provider session", () =>
  runSlice(
    "task-agent-v2-release-plain",
    ({ createTask, runWithStatus, runsOf, repository, v2Runs, sendAsPerson, sessions }) =>
      Effect.gen(function* () {
        const first = yield* createTask;
        yield* eventually("the first run to complete", runWithStatus(first.id, "completed"));
        yield* eventually("the provider session to close", sessionsReleased(sessions, 1));

        const person = { type: "person" } as const;
        yield* repository.setArchived({ ids: [task.id], archived: true, actor: person });
        yield* sendAsPerson(first.threadId, "Archived task: just answer.");
        yield* eventually(
          "the plain turn to complete",
          v2Runs(first.threadId).pipe(
            Effect.map((runs) =>
              Option.fromNullishOr(
                runs.find((run) => run.ordinal === 2 && run.status === "completed"),
              ),
            ),
          ),
        );
        // A wrongful release would follow the turn's terminal event within milliseconds.
        yield* Effect.sleep("500 millis");
        assert.deepInclude(yield* Ref.get(sessions), { opened: 2, closed: 1 });

        // The task's next run uses that session and releases it when it ends.
        yield* repository.setArchived({ ids: [task.id], archived: false, actor: person });
        yield* sendAsPerson(first.threadId, "continue");
        yield* eventually(
          "the continuation to complete",
          runsOf.pipe(
            Effect.map((runs) =>
              Option.fromNullishOr(
                runs.find((run) => run.continuesRunId === first.id && run.status === "completed"),
              ),
            ),
          ),
        );
        yield* eventually("the session to close", sessionsReleased(sessions, 2));
      }),
    { perThreadSessions: true },
  ),
);

/**
 * A run that ends while the provider still holds native background work keeps
 * its session: the release asks the provider and leaves the session to the
 * idle timeout, which releases it once that work and its delivery finish.
 */
const keepsSessionForBackgroundWork = (name: string, description: string, endStatus: string) =>
  runSlice(
    name,
    ({ createTaskWith, runWithStatus, threads, sessions, background }) =>
      Effect.gen(function* () {
        const first = yield* createTaskWith(description);
        yield* eventually("the run to end", runWithStatus(first.id, endStatus));
        const sql = yield* SqlClient.SqlClient;
        // Every release attempt of the ended run has asked the provider.
        yield* eventually(
          "the release to ask the provider",
          sql<{ readonly status: string }>`
            SELECT status FROM orchestration_v2_effect_outbox
            WHERE thread_id = ${first.threadId}
              AND effect_type = 'provider-session.release-idle'
          `.pipe(
            Effect.map((rows) =>
              rows.length > 0 && rows.every((row) => row.status === "succeeded")
                ? Option.some(rows)
                : Option.none(),
            ),
          ),
        );
        assert.deepInclude(yield* Ref.get(sessions), { opened: 1, closed: 0 });
        const kept = yield* threads.getThreadRecords(first.threadId, ["providerSessions"]);
        assert.lengthOf(kept.providerSessions, 1);
        assert.notStrictEqual(kept.providerSessions[0]?.status, "stopped");

        // The background work finishes and its result is delivered.
        yield* Ref.set(background, false);
        yield* eventually("the idle timeout to close the session", sessionsReleased(sessions, 1));
        // The idle timeout stopped the session; a release would have detached it.
        const released = yield* threads.getThreadRecords(first.threadId, ["providerSessions"]);
        assert.strictEqual(released.providerSessions[0]?.status, "stopped");
      }),
    { perThreadSessions: true, providerSessionIdleTimeoutMs: 300 },
  );

it.live("a run that completes with native background work keeps its session until it ends", () =>
  keepsSessionForBackgroundWork(
    "task-agent-v2-release-background",
    `Start a background job. ${BACKGROUND}`,
    "completed",
  ),
);

it.live("a run that fails with native background work keeps its session until it ends", () =>
  keepsSessionForBackgroundWork(
    "task-agent-v2-release-background-failed",
    `Start a background job, then fail. ${BACKGROUND} ${FAIL}`,
    "failed",
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
  runSlice("task-agent-v2-mcp", ({ repository, threads, cwd, started, sendAsPerson, v2Runs }) =>
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

      // The chat sees the finished run as a card once its tasks have settled, without a
      // model turn. Ending the run earlier stands in for the wait.
      const sql = yield* SqlClient.SqlClient;
      const settledAt = new Date(Date.now() - SOURCE_SETTLE_MS).toISOString();
      yield* sql`UPDATE task_agent_runs SET completed_at = ${settledAt} WHERE id = ${run.id}`;
      const wake = yield* TaskSourceWake;
      const cardsOf = threads
        .getThreadRecords(chatThreadId, ["turnItems"], { turnItemTypes: ["notification"] })
        .pipe(Effect.map((records) => records.turnItems));
      const [card] = yield* eventually(
        "the source chat card",
        Effect.gen(function* () {
          yield* wake.sweep;
          const cards = yield* cardsOf;
          return cards.length > 0 ? Option.some(cards) : Option.none();
        }),
      );
      yield* wake.sweep;
      assert.lengthOf(yield* cardsOf, 1);
      assert(card?.type === "notification");
      assert.isNull(card.runId);
      assert.deepStrictEqual(card.source, {
        kind: "task_agent_run",
        tasks: [{ id: createdTask.id, title: task.title, status: "Needs Review" }],
      });
      assert.strictEqual(card.outcome, "completed");
      assert.strictEqual(card.summary, `Task "${task.title}" done`);
      assert.include(card.detail, "Summary: Handled 1");
      // No message was queued and no turn started in the chat.
      const chat = yield* threads.getThreadRecords(chatThreadId, ["runs", "messages"]);
      assert.deepStrictEqual(chat.runs, []);
      assert.deepStrictEqual(chat.messages, []);
      assert.isFalse((yield* Ref.get(started)).some((turn) => turn.threadId === chatThreadId));

      // The next turn the chat takes for another reason carries the card, once.
      const chatTurns = Ref.get(started).pipe(
        Effect.map((turns) => turns.filter((turn) => turn.threadId === chatThreadId)),
      );
      const turnNumber = (count: number) =>
        chatTurns.pipe(
          Effect.map((turns) =>
            turns.length >= count ? Option.some(turns[count - 1]!) : Option.none(),
          ),
        );
      yield* sendAsPerson(chatThreadId, "How did it go?");
      const first = yield* eventually("the chat's first turn", turnNumber(1));
      assert.include(first.text, "Note: these notifications were shown in this thread");
      assert.include(first.text, `- Task "${task.title}" done`);
      assert.include(first.text, "Summary: Handled 1");
      assert.isTrue(first.text.endsWith("User message:\nHow did it go?"));
      yield* eventually(
        "the chat's first run to complete",
        v2Runs(chatThreadId).pipe(
          Effect.map((runs) =>
            Option.fromNullishOr(runs.find((candidate) => candidate.status === "completed")),
          ),
        ),
      );
      yield* sendAsPerson(chatThreadId, "Thanks.");
      const second = yield* eventually("the chat's second turn", turnNumber(2));
      assert.strictEqual(second.text, "Thanks.");
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
