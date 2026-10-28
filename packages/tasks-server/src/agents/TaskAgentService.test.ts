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
  type TaskEvent,
  TaskEventId,
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
import { handOffAgents, handOffPatch } from "../../../tasks-web/src/planner/logic/handOff.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  TaskPromptSettingsStoreLive,
} from "../persistence/TaskPromptSettingsStore.ts";
import {
  noMatchingAgentReason,
  startsForTask,
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
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: now,
    audience: "agent",
    kind: "task",
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

test("an agent task whose tags no agent on its status takes is reported as waiting", () => {
  const nowMs = Date.parse(now);
  NodeAssert.equal(noMatchingAgentReason([agent()], task(), nowMs), null, "the agent takes it");
  NodeAssert.match(
    noMatchingAgentReason([agent()], task({ tags: ["tset"] }), nowMs) ?? "",
    /No enabled agent starts on "new" with these tags/,
  );
  NodeAssert.equal(
    noMatchingAgentReason([agent()], task({ status: "Backlog", tags: [] }), nowMs),
    null,
    "a status no agent starts on is parked on purpose",
  );
  NodeAssert.equal(
    noMatchingAgentReason([agent()], task({ tags: [], audience: "person" }), nowMs),
    null,
  );
});

test("a person task starts only an agent with start tags it carries, and a routine none", () => {
  const nowMs = Date.parse(now);
  const person = task({ audience: "person", status: "new", tags: ["test"] });
  NodeAssert.equal(startsForTask(agent(), person, nowMs), true, "the tags hand it over");
  NodeAssert.equal(startsForTask(agent(), { ...person, tags: [] }, nowMs), false);
  NodeAssert.equal(startsForTask(agent({ startTags: [] }), person, nowMs), false, "status only");
  NodeAssert.equal(
    startsForTask(agent({ startTags: [], startStatuses: [] }), person, nowMs),
    false,
    "catch-all",
  );
  NodeAssert.equal(startsForTask(agent({ startTags: [] }), task({ status: "new" }), nowMs), true);
  NodeAssert.equal(startsForTask(agent(), { ...person, kind: "routine" }, nowMs), false);
});

test("every agent Hand to an agent offers starts on the task it is handed", () => {
  const nowMs = Date.parse(now);
  const person = task({ audience: "person", status: "To Do", tags: ["mine"] });
  const agents = [
    agent({ id: TaskAgentId.make("developer"), name: "Developer", startStatuses: ["To Do"] }),
    agent({
      id: TaskAgentId.make("reviewer"),
      name: "Reviewer",
      startStatuses: ["Needs Review"],
      startTags: [],
    }),
    agent({ id: TaskAgentId.make("any"), name: "Any status", startStatuses: [], startTags: [] }),
    agent({
      id: TaskAgentId.make("fixer"),
      name: "Fixer",
      startStatuses: [],
      startTags: [],
      startRunStatuses: ["failed"],
    }),
  ];

  const offered = handOffAgents(agents, person.projectId);
  NodeAssert.deepEqual(
    offered.map(({ name }) => name),
    ["Any status", "Developer", "Reviewer"],
    "an agent that starts only on another agent's run is not offered",
  );
  for (const chosen of offered) {
    const handedOff = { ...person, ...handOffPatch(person, chosen) } as Task;
    NodeAssert.equal(startsForTask(chosen, handedOff, nowMs), true, chosen.name);
  }
});

test("a started run keeps running while its task's status and tags change", () => {
  NodeAssert.equal(continuesTaskAgentRun(agent(), task({ status: "in_progress", tags: [] })), true);
});

test("closing the task or disabling the agent ends a run", () => {
  NodeAssert.equal(continuesTaskAgentRun(agent(), task({ archivedAt: now })), false);
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

/**
 * Starts the agent on the task through the service, on real prompt storage,
 * and returns the first message of the run.
 */
async function firstTurn(input: {
  readonly task?: Task;
  /** Newest first, as the repository returns them. */
  readonly events?: ReadonlyArray<TaskEvent>;
  readonly previousRun?: TaskAgentRun;
  readonly taskExecution?: ReadonlyArray<{
    readonly projectId: string | null;
    readonly text: string;
  }>;
}): Promise<string | undefined> {
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
    const assignedTask = input.task ?? task();
    const turns: string[] = [];
    const unused = () => Effect.die("unused repository method");
    const repository = new Proxy(
      {
        listAllActiveAgentRuns: () => Effect.succeed([]),
        listAllAgents: () => Effect.succeed([configuredAgent]),
        listAllTasks: () => Effect.succeed([assignedTask]),
        listTriggerCandidates: () => Effect.succeed([assignedTask]),
        getById: () => Effect.succeed(Option.some(assignedTask)),
        getAgentById: () => Effect.succeed(Option.some(configuredAgent)),
        findActiveAgentRunForTaskAgent: () => Effect.succeed(Option.none()),
        searchAgentRuns: () =>
          Effect.succeed(input.previousRun === undefined ? [] : [input.previousRun]),
        startAgentRun: (run: unknown) => Effect.succeed(Option.some(run as never)),
        events: () => Effect.succeed({ events: input.events ?? [] }),
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
        for (const { projectId, text } of input.taskExecution ?? []) {
          yield* write(projectId, text);
        }
        yield* (yield* TaskAgentService).recover;
      }).pipe(Effect.provide(layer)),
    );
    return turns[0];
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

test("a run prompt gets the global taskExecution plus its project's, from real storage", async () => {
  const turn = await firstTurn({
    taskExecution: [
      { projectId: null, text: "Global execution rule." },
      { projectId: "project-1", text: "Run the UpComputer checks." },
      { projectId: "project-other", text: "Other project rule." },
    ],
  });
  NodeAssert.ok(
    turn?.includes(
      'Task execution guidance:\nGlobal execution rule.\n\nProject "UpComputer":\nRun the UpComputer checks.\n\nAssigned task:',
    ),
    turn,
  );
  NodeAssert.ok(!turn?.includes("Other project rule."));
});

function taskEvent(kind: string, payload: unknown, createdAt: string): TaskEvent {
  return {
    id: TaskEventId.make(`event-${createdAt}`),
    taskId: TaskId.make("task-1"),
    kind,
    payload,
    createdAt,
  };
}

test("a first run without events gets no event or previous-run section", async () => {
  const turn = await firstTurn({});
  NodeAssert.ok(turn !== undefined);
  NodeAssert.ok(!turn.includes("Recent task events"), turn);
  NodeAssert.ok(!turn.includes("Your previous run"), turn);
  NodeAssert.ok(turn.includes("Metadata:\n(none)\n\nAgent run identity:"), turn);
  NodeAssert.ok(turn.includes("so do not call task_get at the start"), turn);
  NodeAssert.ok(turn.includes('Claim the task by setting assigneeAgentRunId to "task-agent-run-'));
});

test("a repeat run's first message carries recent events and its previous run, deterministically", async () => {
  const input = {
    task: task({
      output: "Step 1 done; blocked on the staging password.",
      triggerChangedAt: "2026-08-04T12:00:00.000Z",
    }),
    previousRun: run({ status: "blocked" }),
    events: [
      taskEvent(
        "note",
        { text: "Password is in 1Password, item staging-db." },
        "2026-08-04T11:30:00.000Z",
      ),
      taskEvent(
        "task.agent-result",
        {
          source: "task_update",
          agentId: "agent-1",
          agentRunId: "run-1",
          status: "Blocked",
          blocked: true,
          summary: "Needs the staging password.",
        },
        "2026-08-04T11:20:00.000Z",
      ),
      taskEvent("task.updated", { status: "Blocked", tags: ["test"] }, "2026-08-04T11:20:00.000Z"),
      taskEvent(
        "task.status-changed",
        { from: "new", to: "In Progress", actor: { type: "agent-run", agentRunId: "run-1" } },
        "2026-08-04T11:12:00.000Z",
      ),
    ],
  };
  const turn = await firstTurn(input);
  NodeAssert.ok(turn !== undefined);
  NodeAssert.ok(
    turn.includes(`Recent task events (newest last; server snapshots and run starts left out):
- 2026-08-04T11:12:00.000Z task.status-changed by run run-1: new -> In Progress
- 2026-08-04T11:20:00.000Z task.agent-result by agent agent-1 run run-1: Needs the staging password.
  {"source":"task_update","status":"Blocked","blocked":true}
- 2026-08-04T11:30:00.000Z note: Password is in 1Password, item staging-db.

Your previous run on this task:
- runId: run-1
- status: blocked
- ended: 2026-08-04T11:20:00.000Z
Its result is in the current output above;`),
    turn,
  );
  NodeAssert.ok(turn.indexOf("Current output:") < turn.indexOf("Recent task events"));
  NodeAssert.equal(await firstTurn(input), turn, "the same task state gives the same message");
});
