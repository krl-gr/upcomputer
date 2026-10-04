import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  ProjectId,
  ThreadId as ThreadIdBrand,
  CommandId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import { TaskAgentId, TaskId, type Task, type TaskAgent } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { McpSchema, McpServer } from "effect/unstable/ai";

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
import { TaskToolContextResolverLive } from "../context/TaskToolContextResolver.ts";
import { TaskMcpToolsLive } from "../mcp/TaskMcpTools.ts";
import { TaskToolServiceLive } from "../tools/TaskToolService.ts";
import { AllChatsInstructions } from "../persistence/AllChatsInstructions.ts";
import { runTaskMigrations } from "../persistence/runTaskMigrations.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskAgentService, TaskAgentServiceLive } from "./TaskAgentService.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-task-agent-test");
const agentModel = { instanceId, model: "task-agent-model" } satisfies ModelSelection;
const projectId = ProjectId.make("project:task-agents-v2");

/** A message containing this marker keeps its turn running until it is interrupted. */
const HOLD = "[hold-turn]";

interface StartedTurn {
  readonly threadId: ThreadId;
  readonly model: string;
  readonly cwd: string | null;
  readonly text: string;
}

/**
 * A scripted provider: each turn replies with a task_agent_result block and
 * completes, unless its message holds the turn open for a stop.
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
          status: "running" | "completed" | "interrupted",
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
  closedAt: null,
  notBefore: null,
  triggerChangedAt: timestamp,
};

function makeLayer(name: string, cwd: string, started: Ref.Ref<ReadonlyArray<StartedTurn>>) {
  const db = SqlitePersistenceMemory;
  const runtime = makeOrchestratorV2ReplayLayerWithRegistry(
    { name, runtimePolicyOverride: { cwd } },
    ProviderAdapterRegistry.makeSingleLayer(makeTaskAgentAdapter(started)),
    { databaseLayer: db },
  );
  const v2 = Layer.mergeAll(ThreadManagementService.layer, ProjectStore.layer).pipe(
    Layer.provideMerge(runtime),
    Layer.provideMerge(db),
  );
  const allChats = Layer.succeed(AllChatsInstructions, {
    get: Effect.succeed(""),
    set: () => Effect.void,
  });
  const taskStorage = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provide(Layer.effectDiscard(Effect.orDie(runTaskMigrations))),
    Layer.provide(allChats),
  );
  const agents = TaskAgentServiceLive.pipe(
    Layer.provideMerge(taskStorage),
    Layer.provideMerge(v2),
    Layer.provideMerge(NodeServices.layer),
  );
  // The task MCP tools on the core MCP server, as a provider session calls them.
  const tools = TaskMcpToolsLive.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(TaskToolServiceLive),
    Layer.provide(TaskToolContextResolverLive),
    Layer.provide(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) })),
    Layer.provide(ServerSettings.layerTest().pipe(Layer.orDie)),
  );
  return tools.pipe(Layer.provideMerge(agents));
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
  /** Creates the agent and a task in its start status, and waits for the run to start. */
  const createTask = Effect.gen(function* () {
    yield* repository.upsertAgent(agent);
    const created = yield* repository.upsert(task);
    yield* taskAgents.scheduleTaskChanged({ task: created, reason: "created" });
    return yield* eventually(
      "the first run to start",
      runsOf.pipe(Effect.map((runs) => Option.fromNullishOr(runs[0]))),
    );
  });
  return { repository, taskAgents, threads, runsOf, runWithStatus, v2Runs, createTask };
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
            threadId: chatThreadId,
            providerSessionId: "session:task-agents-v2",
            providerInstanceId: instanceId,
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
    }),
  ),
);
