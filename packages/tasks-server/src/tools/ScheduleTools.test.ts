import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { TaskAgentService, type TaskAgentServiceShape } from "../agents/TaskAgentService.ts";
import {
  TaskToolContextResolver,
  type TaskToolContextResolverShape,
} from "../context/TaskToolContextResolver.ts";
import { InboxProject } from "../inbox/InboxProject.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleServiceLive } from "../schedule/TaskScheduleService.ts";
import { PROMPT_GUIDANCE_SCHEDULING, TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import { TaskToolService, TaskToolServiceLive } from "./TaskToolService.ts";
import type { TaskToolInvocationContext } from "./TaskToolTypes.ts";

const timestamp = "2026-10-07T10:00:00.000Z";
const project = ProjectId.make("project-1");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const chat: TaskToolInvocationContext = {
  source: "provider",
  mutationPolicy: "allow",
  threadId: ThreadId.make("thread-chat"),
};
const planMode: TaskToolInvocationContext = { ...chat, mutationPolicy: "deny" };
const runThread = ThreadId.make("thread-run");
/** A task-agent run's thread; its agent lists no tools. */
const agentRun: TaskToolInvocationContext = { ...chat, threadId: runThread, live: true };

const layer = TaskToolServiceLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      TaskScheduleServiceLive,
      Layer.succeed(TaskToolContextResolver, {
        resolve: () =>
          Effect.succeed({
            projects: [],
            resolvedProject: { project: { id: project, title: "Project" } },
          } as never),
      } satisfies TaskToolContextResolverShape),
      Layer.succeed(TaskAgentService, {
        scheduleTaskChanged: () => Effect.void,
      } as unknown as TaskAgentServiceShape),
      Layer.succeed(ThreadManagementService, {} as never),
      Layer.succeed(InboxProject, {} as never),
      Layer.succeed(ProjectStoreV2, {} as never),
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
      Layer.provideMerge(AllChatsInstructionsLive),
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])).pipe(
            Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
          ),
          NodeServices.layer,
          ServerSettings.layerTest({ customInstructions: "" }),
        ),
      ),
    ),
  ),
);

const call = (name: string, args: Record<string, unknown>, context = chat) =>
  Effect.flatMap(TaskToolService, (tools) => tools.call({ name, args, context }));

/** A successful call's JSON body. */
const ok = (name: string, args: Record<string, unknown>, context = chat) =>
  call(name, args, context).pipe(
    Effect.map((result) => {
      assert.equal(result.isError, false, result.text);
      return JSON.parse(result.text);
    }),
  );

const seed = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  for (const id of ["a", "b"])
    yield* repository.upsert({
      id: TaskId.make(id),
      projectId: project,
      title: `Task ${id}`,
      description: `About ${id}`,
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
      audience: "person",
    });
});

/** Entry ids of a day in queue order. */
const day = (date: string) =>
  ok("task_schedule_get", { from: date, to: date }).pipe(
    Effect.map(({ entries }) => entries.map(({ taskId }: { taskId: string }) => taskId)),
  );

it("schedule tools are served, get as a read and the rest as writes", () => {
  const mutations = Object.fromEntries(
    TASK_TOOL_SPECS.filter(({ name }) => name.startsWith("task_schedule_")).map((spec) => [
      spec.name,
      spec.mutation,
    ]),
  );
  assert.deepStrictEqual(mutations, {
    task_schedule_get: "read",
    task_schedule_add: "write",
    task_schedule_update: "write",
    task_schedule_move: "write",
    task_schedule_delete: "write",
  });
});

it.effect("task_schedule_add plans tasks in order, by time or at a placement", () =>
  Effect.gen(function* () {
    yield* seed;
    const added = yield* ok("task_schedule_add", { taskIds: ["a", "b"], date: "2026-10-08" });
    assert.deepStrictEqual(
      added.entries.map(({ taskId, status }: { taskId: string; status: string }) => [
        taskId,
        status,
      ]),
      [
        ["a", "open"],
        ["b", "open"],
      ],
    );
    yield* ok("task_schedule_add", {
      taskIds: ["b"],
      date: "2026-10-08",
      placement: { at: "top" },
      startTime: "09:30",
      durationMinutes: 45,
    });
    assert.deepStrictEqual(yield* day("2026-10-08"), ["b", "a", "b"]);

    const missing = yield* call("task_schedule_add", { taskIds: ["nope"], date: "2026-10-08" });
    assert.equal(missing.isError, true);
    assert.include(missing.text, "Task 'nope' was not found.");
    const invalid = yield* call("task_schedule_add", { taskIds: ["a"], date: "2026-02-30" });
    assert.equal(invalid.isError, true);
  }).pipe(Effect.provide(layer)),
);

it.effect("task_schedule_get reads a range with its tasks, or one task's entries", () =>
  Effect.gen(function* () {
    yield* seed;
    yield* ok("task_schedule_add", { taskIds: ["a"], date: "2026-10-08" });
    yield* ok("task_schedule_add", { taskIds: ["a", "b"], date: "2026-10-09" });

    const range = yield* ok("task_schedule_get", { from: "2026-10-08", to: "2026-10-09" });
    assert.deepStrictEqual(
      range.entries.map(({ date, taskId }: { date: string; taskId: string }) => [date, taskId]),
      [
        ["2026-10-08", "a"],
        ["2026-10-09", "a"],
        ["2026-10-09", "b"],
      ],
    );
    // Tasks once each, without their descriptions.
    assert.deepStrictEqual(
      range.tasks.toSorted((left: { id: string }, right: { id: string }) =>
        left.id.localeCompare(right.id),
      ),
      [
        {
          id: "a",
          title: "Task a",
          status: "To Do",
          audience: "person",
          projectId: project,
          tags: [],
          archivedAt: null,
        },
        {
          id: "b",
          title: "Task b",
          status: "To Do",
          audience: "person",
          projectId: project,
          tags: [],
          archivedAt: null,
        },
      ],
    );

    const first = yield* ok("task_schedule_get", { taskId: "a", limit: 1 });
    assert.deepStrictEqual(
      first.entries.map(({ date }: { date: string }) => date),
      ["2026-10-08"],
    );
    const rest = yield* ok("task_schedule_get", { taskId: "a", cursor: first.nextCursor });
    assert.deepStrictEqual(
      rest.entries.map(({ date }: { date: string }) => date),
      ["2026-10-09"],
    );
    assert.equal(rest.nextCursor, null);

    for (const [args, message] of [
      [{}, "Pass from and to, or taskId."],
      [{ from: "2026-10-08" }, "Pass from and to, or taskId."],
      [{ taskId: "a", from: "2026-10-08", to: "2026-10-09" }, "not both"],
      [{ from: "2026-10-01", to: "2026-12-31" }, "at most 62 days"],
    ] as const) {
      const refused = yield* call("task_schedule_get", args);
      assert.equal(refused.isError, true);
      assert.include(refused.text, message);
    }
  }).pipe(Effect.provide(layer)),
);

it.effect("task_schedule_update changes status and timing in place", () =>
  Effect.gen(function* () {
    yield* seed;
    const [entry] = (yield* ok("task_schedule_add", {
      taskIds: ["a"],
      date: "2026-10-08",
      startTime: "10:00",
      durationMinutes: 30,
    })).entries;
    const done = yield* ok("task_schedule_update", { id: entry.id, status: "done" });
    assert.deepStrictEqual(
      done.entries.map(({ id, status, startTime }: Record<string, unknown>) => ({
        id,
        status,
        startTime,
      })),
      [{ id: entry.id, status: "done", startTime: "10:00" }],
    );
    const cleared = yield* ok("task_schedule_update", {
      id: entry.id,
      startTime: null,
      durationMinutes: null,
    });
    assert.equal(cleared.entries[0].startTime, null);
    assert.equal(cleared.entries[0].durationMinutes, null);
    assert.equal(cleared.entries[0].status, "done");

    const missing = yield* call("task_schedule_update", { id: "missing", status: "done" });
    assert.equal(missing.isError, true);
    assert.include(missing.text, "Schedule entry 'missing' was not found.");
  }).pipe(Effect.provide(layer)),
);

it.effect("task_schedule_move moves entries as a block, keeping ids and status", () =>
  Effect.gen(function* () {
    yield* seed;
    const added = (yield* ok("task_schedule_add", { taskIds: ["a", "b"], date: "2026-10-08" }))
      .entries;
    yield* ok("task_schedule_update", { id: added[1].id, status: "skipped" });
    yield* ok("task_schedule_add", { taskIds: ["a"], date: "2026-10-09" });

    const moved = yield* ok("task_schedule_move", {
      ids: added.map(({ id }: { id: string }) => id),
      date: "2026-10-09",
      placement: { at: "top" },
      startTime: "08:00",
    });
    assert.deepStrictEqual(
      moved.entries.map(({ id, date, status, startTime }: Record<string, unknown>) => ({
        id,
        date,
        status,
        startTime,
      })),
      [
        { id: added[0].id, date: "2026-10-09", status: "open", startTime: "08:00" },
        { id: added[1].id, date: "2026-10-09", status: "skipped", startTime: "08:00" },
      ],
    );
    assert.deepStrictEqual(yield* day("2026-10-08"), []);
    assert.deepStrictEqual(yield* day("2026-10-09"), ["a", "b", "a"]);
  }).pipe(Effect.provide(layer)),
);

it.effect("task_schedule_delete removes entries and keeps the tasks", () =>
  Effect.gen(function* () {
    yield* seed;
    const [entry] = (yield* ok("task_schedule_add", { taskIds: ["a"], date: "2026-10-08" }))
      .entries;
    const deleted = yield* ok("task_schedule_delete", { ids: [entry.id] });
    assert.deepStrictEqual(
      deleted.deleted.map(({ id }: { id: string }) => id),
      [entry.id],
    );
    assert.deepStrictEqual(yield* day("2026-10-08"), []);
    assert.equal((yield* ok("task_get", { id: "a" })).task.id, "a");
  }).pipe(Effect.provide(layer)),
);

it.effect("a read-only mode dry-runs every schedule write and stores nothing", () =>
  Effect.gen(function* () {
    yield* seed;
    const [entry] = (yield* ok("task_schedule_add", { taskIds: ["a"], date: "2026-10-08" }))
      .entries;
    const writes = [
      ["task_schedule_add", { taskIds: ["b"], date: "2026-10-08" }],
      ["task_schedule_update", { id: entry.id, status: "done" }],
      ["task_schedule_move", { ids: [entry.id], date: "2026-10-09" }],
      ["task_schedule_delete", { ids: [entry.id] }],
    ] as const;
    for (const [name, args] of writes) {
      const result = yield* ok(name, args, planMode);
      assert.equal(result.dryRun, true, name);
    }
    const [unchanged] = (yield* ok("task_schedule_get", { from: "2026-10-08", to: "2026-10-09" }))
      .entries;
    assert.deepStrictEqual(
      { id: unchanged.id, date: unchanged.date, status: unchanged.status },
      { id: entry.id, date: "2026-10-08", status: "open" },
    );
    // Reads stay allowed.
    assert.deepStrictEqual(
      (yield* ok("task_schedule_get", { taskId: "a" }, planMode)).entries.length,
      1,
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("a task-agent run may write the schedule without listing the tools", () =>
  Effect.gen(function* () {
    yield* seed;
    const repository = yield* TaskRepository;
    yield* repository.upsertAgent({
      id: TaskAgentId.make("agent"),
      projectId: null,
      name: "agent",
      enabled: true,
      startStatuses: [],
      startTags: ["agent"],
      startRunStatuses: [],
      config: { role: "agent", modelSelection, instructions: "Work." },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    yield* repository.createAgentRun({
      id: TaskAgentRunId.make("run-1"),
      taskId: TaskId.make("a"),
      agentId: TaskAgentId.make("agent"),
      threadId: runThread,
      modelSelection,
      status: "running",
      startedAt: timestamp,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: null,
    });
    const added = yield* ok("task_schedule_add", { taskIds: ["a"], date: "2026-10-08" }, agentRun);
    const id = added.entries[0].id;
    yield* ok("task_schedule_update", { id, status: "done" }, agentRun);
    yield* ok("task_schedule_move", { ids: [id], date: "2026-10-09" }, agentRun);
    assert.deepStrictEqual(yield* day("2026-10-09"), ["a"]);
    yield* ok("task_schedule_delete", { ids: [id] }, agentRun);
    assert.deepStrictEqual(yield* day("2026-10-09"), []);
  }).pipe(Effect.provide(layer)),
);

it.effect("task_context tells agents to schedule for the user only when asked", () =>
  Effect.gen(function* () {
    const context = yield* ok("task_context", {});
    assert.equal(context.promptGuidanceScheduling, PROMPT_GUIDANCE_SCHEDULING);
    assert.include(PROMPT_GUIDANCE_SCHEDULING, "only when the user asked for it");
  }).pipe(Effect.provide(layer)),
);
