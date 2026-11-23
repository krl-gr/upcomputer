import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { TaskAgentId, TaskAgentRunId, type TaskChange } from "@t3tools/tasks-contracts/v1";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import {
  TaskAgentService,
  type TaskAgentServiceShape,
  type TaskChangedInput,
} from "../agents/TaskAgentService.ts";
import {
  TaskToolContextResolver,
  type TaskToolContextResolverShape,
} from "../context/TaskToolContextResolver.ts";
import { layer as BotServiceLayer } from "../bots/BotService.ts";
import { InboxProject } from "../inbox/InboxProject.ts";
import { AllChatsInstructionsLive } from "../persistence/AllChatsInstructions.ts";
import { TaskPersistenceSqlError } from "../persistence/Errors.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleService } from "../schedule/TaskScheduleService.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import { TaskToolService, TaskToolServiceLive } from "./TaskToolService.ts";
import type { TaskToolInvocationContext } from "./TaskToolTypes.ts";
import { InstructionUpdatesService } from "../instructionUpdates/InstructionUpdatesService.ts";

const project = ProjectId.make("project-1");
const inbox = ProjectId.make("project-inbox");
const chatThread = ThreadId.make("thread-chat");
const chat: TaskToolInvocationContext = {
  source: "provider",
  mutationPolicy: "allow",
  threadId: chatThread,
};

/**
 * Fresh storage and the task tools, with agent scheduling recorded. `wrap`
 * changes the repository the tools see, e.g. to fail one write.
 */
function harness(
  wrap: (repository: TaskRepositoryShape) => TaskRepositoryShape = (r) => r,
  options: { readonly resolvesProject?: boolean } = {},
) {
  const scheduled: TaskChangedInput[] = [];
  const agents = {
    scheduleTaskChanged: (input: TaskChangedInput) => Effect.sync(() => void scheduled.push(input)),
    scheduleAgentChanged: () => Effect.void,
  } as unknown as TaskAgentServiceShape;
  // Every chat is titled "Old title" and idle in the project; thread commands are only recorded.
  const dispatched: Array<{
    readonly type: string;
    readonly commandId?: string;
    readonly threadId?: string;
    title?: string;
    readonly runtimeMode?: string;
    readonly interactionMode?: string;
  }> = [];
  const threadModes = new Map<string, { runtimeMode: string; interactionMode: string }>();
  const threads = {
    getThreadShell: (threadId: ThreadId) =>
      Effect.succeed({
        id: threadId,
        projectId: project,
        ...(threadModes.get(threadId) ?? {
          runtimeMode: "approval-required",
          interactionMode: "default",
        }),
      }),
    getThreadRecords: (threadId: ThreadId) =>
      Effect.succeed({
        thread: {
          id: threadId,
          title: "Old title",
          projectId: project,
          deletedAt: null,
          ...(threadModes.get(threadId) ?? {
            runtimeMode: "approval-required",
            interactionMode: "default",
          }),
        },
        runs: [],
        runtimeRequests: [],
      }),
    hasReceipt: (commandId: string) =>
      Effect.succeed(dispatched.some((command) => command.commandId === commandId)),
    dispatch: (command: (typeof dispatched)[number]) =>
      Effect.sync(() => {
        dispatched.push(command);
        if (command.threadId && command.type === "thread.create") {
          threadModes.set(command.threadId, {
            runtimeMode: command.runtimeMode ?? "full-access",
            interactionMode: command.interactionMode ?? "default",
          });
        } else if (
          command.threadId &&
          command.type === "thread.runtime-mode.set" &&
          command.runtimeMode
        ) {
          const prev = threadModes.get(command.threadId) ?? {
            runtimeMode: "full-access",
            interactionMode: "default",
          };
          threadModes.set(command.threadId, { ...prev, runtimeMode: command.runtimeMode });
        } else if (
          command.threadId &&
          command.type === "thread.interaction-mode.set" &&
          command.interactionMode
        ) {
          const prev = threadModes.get(command.threadId) ?? {
            runtimeMode: "full-access",
            interactionMode: "default",
          };
          threadModes.set(command.threadId, { ...prev, interactionMode: command.interactionMode });
        }
      }),
  };
  const database = Layer.effectDiscard(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
  ).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));
  const storage = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provideMerge(AllChatsInstructionsLive),
    Layer.provideMerge(
      Layer.mergeAll(
        database,
        NodeServices.layer,
        NodeCrypto.layer,
        ServerSettings.layerTest({ customInstructions: "" }),
      ),
    ),
  );
  const resolver: TaskToolContextResolverShape = {
    resolve: () =>
      Effect.succeed({
        projects: [],
        ...(options.resolvesProject === false
          ? {}
          : { resolvedProject: { project: { id: project, title: "Project" } } }),
      } as never),
  };
  const toolRepository = Layer.effect(
    TaskRepository,
    Effect.gen(function* () {
      return wrap(yield* TaskRepository);
    }),
  );
  const layer = TaskToolServiceLive.pipe(
    Layer.provide(toolRepository),
    Layer.provideMerge(
      BotServiceLayer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            storage,
            Layer.succeed(TaskToolContextResolver, resolver),
            Layer.succeed(TaskAgentService, agents),
            Layer.succeed(ThreadManagementService, threads as never),
            Layer.succeed(ProjectStoreV2, {
              getShell: () => Effect.succeedSome({}),
            } as never),
            Layer.succeed(InboxProject, { ensure: Effect.succeed(inbox) }),
            Layer.succeed(TaskScheduleService, {} as never),
            Layer.succeed(InstructionUpdatesService, {} as never),
          ),
        ),
      ),
    ),
  );
  const create = (args: Record<string, unknown>, context: TaskToolInvocationContext = chat) =>
    Effect.gen(function* () {
      return yield* (yield* TaskToolService).call({ name: "task_create", args, context });
    });
  const update = (args: Record<string, unknown>) =>
    Effect.gen(function* () {
      return yield* (yield* TaskToolService).call({ name: "task_update", args, context: chat });
    });
  // From the bottom: new tasks go on top, so this is the order they were created in.
  const stored = Effect.gen(function* () {
    return yield* (yield* TaskRepository).search({ limit: 50, kind: "all", from: "bottom" });
  });
  return { layer, scheduled, dispatched, threadModes, create, update, stored };
}

const item = (title: string, status: string, extra: Record<string, unknown> = {}) => ({
  title,
  description: `Do ${title}.`,
  status,
  audience: "agent",
  ...extra,
});

it.effect(
  "a tasks list is created in order, each with its own fields, and each scheduled once",
  () => {
    const { layer, scheduled, create, stored } = harness();
    return Effect.gen(function* () {
      const earlier = yield* create(item("earlier", "Done"));
      assert.isFalse(earlier.isError, earlier.text);
      scheduled.length = 0;

      const result = yield* create({
        tasks: [
          item("first", "To Do", { tags: ["dev"], metadata: { targetAgentId: "agent-dev" } }),
          item("second", "Backlog", { tags: ["dev"] }),
          item("third", "Backlog", { notBefore: "2026-10-12T09:00:00+02:00" }),
        ],
      });
      assert.isFalse(result.isError, result.text);
      const created = JSON.parse(result.text).tasks;
      assert.deepStrictEqual(
        created.map(({ title, status, tags }: Record<string, unknown>) => [title, status, tags]),
        [
          ["first", "To Do", ["dev"]],
          ["second", "Backlog", ["dev"]],
          ["third", "Backlog", []],
        ],
      );
      // The caller wrote the descriptions; the result leaves them out.
      assert.notProperty(created[0], "description");
      assert.equal(created[2].notBefore, "2026-10-12T07:00:00.000Z");

      // New tasks go to the top, the list's first task lowest: queues run
      // from the bottom, so the list runs in the order given.
      const repository = yield* TaskRepository;
      assert.deepStrictEqual(
        (yield* repository.search({})).map(({ title }) => title),
        ["third", "second", "first", "earlier"],
      );
      const queue = yield* repository.search({ tags: ["dev"], from: "bottom" });
      assert.deepStrictEqual(
        queue.map(({ title }) => title),
        ["first", "second"],
      );
      const tasks = yield* stored;
      assert.deepStrictEqual(
        tasks.map(({ title }) => title),
        ["earlier", "first", "second", "third"],
      );
      const ranks = tasks.map(({ rank }) => rank);
      assert.deepStrictEqual(ranks, ranks.toSorted().toReversed());
      assert.equal(new Set(ranks).size, ranks.length);
      const first = tasks[1]!;
      assert.equal(first.description, "Do first.");
      assert.deepStrictEqual(first.metadata, { targetAgentId: "agent-dev" });
      assert.equal(first.projectId, project);
      assert.equal(first.sourceThreadId, chatThread);
      assert.equal(tasks[2]!.metadata, null);

      assert.deepStrictEqual(
        scheduled.map(({ task, reason }) => [task.title, reason]),
        [
          ["first", "created"],
          ["second", "created"],
          ["third", "created"],
        ],
      );
    }).pipe(Effect.provide(layer));
  },
);

it.effect("the calling thread is the source, whatever thread id a fork copied from history", () => {
  const { layer, create, stored } = harness();
  // A fork repeats its parent's calls, including the parent's thread id.
  const parent = { sourceThreadId: "thread-parent" };
  const fork: TaskToolInvocationContext = { ...chat, threadId: ThreadId.make("thread-fork") };
  return Effect.gen(function* () {
    const one = yield* create(item("one", "To Do", parent), fork);
    assert.isFalse(one.isError, one.text);
    const list = yield* create(
      { tasks: [item("two", "To Do", parent), item("three", "To Do", { sourceThreadId: null })] },
      fork,
    );
    assert.isFalse(list.isError, list.text);
    // Without a calling thread there is nothing better than the given one.
    const unbound = yield* create(item("four", "To Do", parent), {
      source: "mcp",
      mutationPolicy: "allow",
    });
    assert.isFalse(unbound.isError, unbound.text);

    assert.deepStrictEqual(
      (yield* stored).map(({ title, sourceThreadId, rootThreadId }) => [
        title,
        sourceThreadId,
        rootThreadId,
      ]),
      [
        ["one", "thread-fork", "thread-fork"],
        ["two", "thread-fork", "thread-fork"],
        // An explicit null still opts out of reports.
        ["three", null, "thread-fork"],
        ["four", "thread-parent", "thread-parent"],
      ],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("an invalid list names the failing item and creates nothing", () => {
  const { layer, scheduled, create, stored } = harness();
  return Effect.gen(function* () {
    const refused = (args: Record<string, unknown>, expected: RegExp) =>
      Effect.gen(function* () {
        const result = yield* create(args);
        assert.isTrue(result.isError);
        assert.match(result.text, expected);
        assert.match(result.text, /No task was created/);
      });

    yield* refused(
      { tasks: [item("ok", "To Do"), item("bad", "")] },
      /^tasks\[1\] \("bad"\) is invalid: /,
    );
    yield* refused({ tasks: [item("ok", "To Do"), { status: "To Do" }] }, /^tasks\[1\] is invalid/);
    yield* refused(
      { tasks: [item("ok", "To Do"), item("ok", "Backlog", { notBefore: "tomorrow" })] },
      /^tasks\[1\] \("ok"\)/,
    );
    yield* refused({ title: "stray", tasks: [item("ok", "To Do")] }, /Move title into the items/);
    yield* refused({ tasks: [] }, /1 to 50 tasks; got 0/);
    yield* refused(
      { tasks: [item("a", "To Do", { id: "same" }), item("b", "To Do", { id: "same" })] },
      /'same' appears more than once/,
    );

    assert.lengthOf(yield* stored, 0);
    assert.lengthOf(scheduled, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("a write failing partway rolls back the whole list and schedules nothing", () => {
  let upserts = 0;
  const { layer, scheduled, create, stored } = harness((repository) => ({
    ...repository,
    // The second task is written, then its write fails inside the transaction.
    upsert: (task) =>
      repository
        .upsert(task)
        .pipe(
          Effect.andThen((saved) =>
            ++upserts === 2
              ? Effect.fail(new TaskPersistenceSqlError({ operation: "test", detail: "disk full" }))
              : Effect.succeed(saved),
          ),
        ),
  }));
  return Effect.gen(function* () {
    const result = yield* create({
      tasks: [item("a", "To Do"), item("b", "Backlog"), item("c", "Backlog")],
    });
    assert.isTrue(result.isError);
    assert.match(result.text, /disk full/);
    assert.equal(upserts, 2);
    assert.lengthOf(yield* stored, 0);
    assert.lengthOf(scheduled, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("a dry run previews the list without writing", () => {
  const { layer, scheduled, create, stored } = harness();
  return Effect.gen(function* () {
    const result = yield* create(
      { tasks: [item("a", "To Do"), item("b", "Backlog")] },
      { ...chat, mutationPolicy: "deny" },
    );
    assert.isFalse(result.isError, result.text);
    const preview = JSON.parse(result.text);
    assert.isTrue(preview.dryRun);
    // A dry run must not read as success to the model that relays it.
    assert.match(preview.notice, /^Nothing was saved/);
    const planPreview = JSON.parse(
      (yield* create(
        { tasks: [item("a", "To Do")] },
        { ...chat, mutationPolicy: "deny", interactionMode: "plan" },
      )).text,
    );
    assert.match(planPreview.notice, /^Plan mode: nothing was saved/);
    assert.deepStrictEqual(
      preview.tasks.map(({ title }: { title: string }) => title),
      ["a", "b"],
    );
    assert.lengthOf(yield* stored, 0);
    assert.lengthOf(scheduled, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("a list sets each item's audience, and routines are the user's", () => {
  const { layer, create, stored } = harness();
  return Effect.gen(function* () {
    const refused = yield* create({
      tasks: [item("habit", "To Do", { kind: "routine", audience: "agent" })],
    });
    assert.isTrue(refused.isError);
    assert.match(refused.text, /^tasks\[0\] \("habit"\) is invalid: /);
    assert.lengthOf(yield* stored, 0);

    const result = yield* create({
      tasks: [
        item("agent work", "To Do"),
        item("my errand", "To Do", { audience: "person" }),
        item("weekly review", "To Do", { kind: "routine", audience: "person" }),
      ],
    });
    assert.isFalse(result.isError, result.text);
    // The result says whose each task is and where it shows.
    const { shownIn, tasks: created } = JSON.parse(result.text);
    assert.deepStrictEqual(
      created.map(({ audience }: { audience: string }) => audience),
      ["agent", "person", "person"],
    );
    assert.match(shownIn.person, /user's planner/);
    assert.match(shownIn.agent, /agents' table/);
    assert.deepStrictEqual(
      (yield* stored).map(({ title, audience, kind }) => [title, audience, kind]),
      [
        ["agent work", "agent", "task"],
        ["my errand", "person", "task"],
        ["weekly review", "person", "routine"],
      ],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("without a project, a list of person tasks goes to the Inbox", () => {
  const { layer, create, stored } = harness((r) => r, { resolvesProject: false });
  return Effect.gen(function* () {
    const mixed = yield* create({
      tasks: [item("mine", "To Do", { audience: "person" }), item("agent's", "To Do")],
    });
    assert.isTrue(mixed.isError);
    assert.match(mixed.text, /so no task was created/);
    assert.lengthOf(yield* stored, 0);

    const result = yield* create({
      tasks: [
        item("mine", "To Do", { audience: "person" }),
        item("also mine", "To Do", { kind: "routine", audience: "person" }),
      ],
    });
    assert.isFalse(result.isError, result.text);
    assert.deepStrictEqual(
      (yield* stored).map(({ title, projectId }) => [title, projectId]),
      [
        ["mine", inbox],
        ["also mine", inbox],
      ],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("a task without an audience is refused, alone or in a list", () => {
  const { layer, create, stored } = harness();
  return Effect.gen(function* () {
    const { audience: _audience, ...unassigned } = item("call the bank", "To Do");
    const single = yield* create(unassigned);
    assert.isTrue(single.isError);
    assert.match(single.text, /^audience is required: person when the user does the task/);
    assert.match(single.text, /No task was created/);

    const listed = yield* create({ tasks: [item("ok", "To Do"), unassigned] });
    assert.isTrue(listed.isError);
    assert.match(listed.text, /^tasks\[1\] \("call the bank"\) is invalid: audience is required/);
    assert.lengthOf(yield* stored, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("one task's result names its audience and where it shows", () => {
  const { layer, create } = harness();
  return Effect.gen(function* () {
    const mine = JSON.parse(
      (yield* create(item("call the bank", "To Do", { audience: "person" }))).text,
    );
    assert.equal(mine.audience, "person");
    assert.match(mine.shownIn, /^Person task: shown in the user's planner/);
    assert.equal(mine.task.audience, "person");
    const theirs = JSON.parse((yield* create(item("fix the build", "To Do"))).text);
    assert.equal(theirs.audience, "agent");
    assert.match(theirs.shownIn, /^Agent task: shown in the agents' table/);
  }).pipe(Effect.provide(layer));
});

it("the task_create schema requires every listed task's audience and explains it", () => {
  const schema = TASK_TOOL_SPECS.find(({ name }) => name === "task_create")?.inputSchema as {
    properties: {
      audience: { enum: string[]; description: string };
      tasks: { items: { required: string[] } };
    };
  };
  assert.include(schema.properties.tasks.items.required, "audience");
  assert.deepStrictEqual(schema.properties.audience.enum, ["person", "agent"]);
  assert.match(schema.properties.audience.description, /^Required\./);
  assert.include(schema.properties.audience.description, '"for me"');
  assert.notInclude(schema.properties.audience.description, "default");
});

it.effect("a person task is To Do or Done on create, in a list and on update", () => {
  const { layer, create, update, stored } = harness();
  return Effect.gen(function* () {
    const mine = (title: string, status: string) => item(title, status, { audience: "person" });
    const single = yield* create(mine("deferred", "Backlog"));
    assert.isTrue(single.isError);
    assert.match(single.text, /person task's status is "To Do" \(open\) or "Done", not "Backlog"/);
    assert.match(single.text, /leave it unscheduled or set notBefore/);
    const list = yield* create({ tasks: [mine("ok", "To Do"), mine("later", "In Progress")] });
    assert.isTrue(list.isError);
    assert.match(list.text, /^tasks\[1\] \("later"\) is invalid: A person task's status/);
    assert.lengthOf(yield* stored, 0);

    const created = yield* create(mine("call the bank", "To Do"));
    assert.isFalse(created.isError, created.text);
    const id = JSON.parse(created.text).task.id;
    const refused = yield* update({ id, status: "Blocked" });
    assert.isTrue(refused.isError);
    assert.match(refused.text, /not "Blocked".*The task was not changed/);
    const done = yield* update({ id, status: "Done" });
    assert.isFalse(done.isError, done.text);

    // Agent statuses stay free; a status set with the hand-back must suit a person.
    const agentTask = yield* create(item("build", "In Progress"));
    const agentId = JSON.parse(agentTask.text).task.id;
    const mixed = yield* update({ id: agentId, audience: "person", status: "Review" });
    assert.isTrue(mixed.isError);
    const handedBack = yield* update({ id: agentId, audience: "person" });
    assert.isFalse(handedBack.isError, handedBack.text);
    assert.deepStrictEqual(
      (yield* stored).map(({ title, status, audience }) => [title, status, audience]),
      [
        ["call the bank", "Done", "person"],
        ["build", "To Do", "person"],
      ],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("agent_update refuses a modelAlias that does not resolve and keeps the old model", () => {
  const { layer } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const agent = yield* repository.upsertAgent({
      id: TaskAgentId.make("task-agent-dev"),
      projectId: project,
      name: "Dev",
      enabled: false,
      startStatuses: [],
      startTags: [],
      startRunStatuses: [],
      config: {
        role: "Dev",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        instructions: "Build it.",
      },
      createdAt: "2026-10-22T00:00:00.000Z",
      updatedAt: "2026-10-22T00:00:00.000Z",
      archivedAt: null,
    });
    const result = yield* (yield* TaskToolService).call({
      name: "agent_update",
      args: { id: agent.id, modelAlias: "claude-opus-5-5" },
      context: chat,
    });
    assert.isTrue(result.isError, result.text);
    assert.equal(
      JSON.parse(result.text).error,
      "Unable to resolve the explicit agent model selection or alias.",
    );
    assert.deepStrictEqual(
      Option.getOrThrow(yield* repository.getAgentById({ id: agent.id })).config.modelSelection,
      agent.config.modelSelection,
    );
  }).pipe(Effect.provide(layer));
});

it.effect("a task delegated from a bot's permanent chat reports and counts there", () => {
  const { layer, create, stored } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const sql = yield* SqlClient.SqlClient;
    const botChat = ThreadId.make("bot-chat:bot:helper");
    const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
    const at = "2026-10-26T00:00:00.000Z";
    for (const id of [TaskAgentId.make("bot:helper"), TaskAgentId.make("agent-dev")])
      yield* repository.upsertAgent({
        id,
        projectId: null,
        name: id,
        enabled: true,
        startStatuses: ["To Do"],
        startTags: [],
        startRunStatuses: [],
        config: { role: "Agent", modelSelection, instructions: "Work." },
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      });
    yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json, adopted)
      VALUES ('bot:helper', ${botChat}, ${project}, ${JSON.stringify([project])}, 0)`;

    // To the task tools a bot chat is a chat like any other: no run calls from it.
    const result = yield* create(
      item("delegated", "To Do", { metadata: { targetAgentId: "agent-dev" } }),
      { ...chat, threadId: botChat },
    );
    assert.isFalse(result.isError, result.text);
    const [task] = yield* stored;
    assert.equal(task?.sourceThreadId, botChat);
    assert.equal(task?.rootThreadId, botChat);
    if (!task) return;
    yield* repository.createAgentRun({
      id: TaskAgentRunId.make("run-delegated"),
      taskId: task.id,
      agentId: TaskAgentId.make("agent-dev"),
      threadId: ThreadId.make("thread-delegated-run"),
      modelSelection,
      status: "running",
      startedAt: at,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: null,
    });
    const counts = yield* repository.threadRunCounts({ threadIds: [botChat] });
    assert.deepStrictEqual(counts.threads[0]?.runCounts, [{ status: "running", count: 1 }]);
  }).pipe(Effect.provide(layer));
});

it.effect("a chat cannot move a task back while another thread's run works on it", () => {
  const { layer, create, update, stored } = harness();
  return Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const at = "2026-11-23T18:18:00.000Z";
    const modelSelection = { instanceId: ProviderInstanceId.make("opencode"), model: "glm-5.4" };
    yield* repository.upsertAgent({
      id: TaskAgentId.make("agent-scribe"),
      projectId: null,
      name: "Scribe",
      enabled: true,
      startStatuses: ["To Do"],
      startTags: [],
      startRunStatuses: [],
      config: { role: "Agent", modelSelection, instructions: "Work." },
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
    });
    yield* create(item("recipes", "To Do"));
    const [task] = yield* stored;
    if (!task) return assert.fail("the task was not created");
    // The person's Continue started this run while the chat was still reacting to the failure.
    const runThread = ThreadId.make("thread-continued-run");
    yield* repository.createAgentRun({
      id: TaskAgentRunId.make("run-continued"),
      taskId: task.id,
      agentId: TaskAgentId.make("agent-scribe"),
      threadId: runThread,
      modelSelection,
      status: "running",
      startedAt: at,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: TaskAgentRunId.make("run-failed"),
    });
    const asRun = (args: Record<string, unknown>) =>
      Effect.flatMap(TaskToolService, (tools) =>
        tools.call({ name: "task_update", args, context: { ...chat, threadId: runThread } }),
      );
    assert.isFalse((yield* asRun({ id: task.id, status: "In Progress" })).isError);

    const retry = yield* update({ id: task.id, status: "To Do" });
    assert.isTrue(retry.isError);
    assert.include(retry.text, "run-continued");
    assert.equal((yield* stored)[0]?.status, "In Progress");
    // Other fields stay open to the chat, and the run itself still sets the status.
    assert.isFalse((yield* update({ id: task.id, output: "Noted." })).isError);
    assert.isFalse((yield* asRun({ id: task.id, status: "To Verify" })).isError);
    assert.equal((yield* stored)[0]?.status, "To Verify");
  }).pipe(Effect.provide(layer));
});

/** A bot and a task agent, each with its own chat, as the bot settings save them. */
const seedBotAndAgent = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const sql = yield* SqlClient.SqlClient;
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
  const at = "2026-10-27T00:00:00.000Z";
  for (const id of [TaskAgentId.make("bot:named"), TaskAgentId.make("agent-dev")])
    yield* repository.upsertAgent({
      id,
      projectId: null,
      name: "Old title",
      enabled: false,
      startStatuses: ["To Do"],
      startTags: [],
      startRunStatuses: [],
      config: { role: "Agent", modelSelection, instructions: "Work." },
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
    });
  yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json, adopted)
    VALUES ('bot:named', 'bot-chat:named', ${project}, ${JSON.stringify([project])}, 0)`;
});

it.effect("agent_update renaming a bot renames its chat and tells clients", () => {
  const { layer, dispatched } = harness();
  return Effect.gen(function* () {
    yield* seedBotAndAgent;
    // The stream opens with a sync; once it arrives, later writes reach this subscriber.
    const subscribed = yield* Deferred.make<void>();
    const agentsChanged = yield* Deferred.make<TaskChange>();
    yield* (yield* TaskRepository).changes.pipe(
      Stream.runForEach((change) =>
        change.kind === "sync"
          ? Deferred.succeed(subscribed, undefined)
          : change.agentsChanged
            ? Deferred.succeed(agentsChanged, change)
            : Effect.void,
      ),
      Effect.forkScoped,
    );
    yield* Deferred.await(subscribed);
    const result = yield* (yield* TaskToolService).call({
      name: "agent_update",
      args: { id: "bot:named", name: "Up Growth Analyst" },
      context: { ...chat, live: true, runtimeMode: "full-access" },
    });
    assert.isFalse(result.isError, result.text);
    assert.deepStrictEqual(
      dispatched.map(({ type, threadId, title }) => ({ type, threadId, title })),
      [{ type: "thread.metadata.update", threadId: "bot-chat:named", title: "Up Growth Analyst" }],
    );
    // Open bot lists refetch on this; before, an agent write reached no client.
    assert.deepStrictEqual((yield* Deferred.await(agentsChanged)).taskIds, []);
  }).pipe(Effect.provide(layer));
});

it.effect("agent_update renaming a task agent leaves every chat alone", () => {
  const { layer, dispatched } = harness();
  return Effect.gen(function* () {
    yield* seedBotAndAgent;
    const result = yield* (yield* TaskToolService).call({
      name: "agent_update",
      args: { id: "agent-dev", name: "Developer" },
      context: chat,
    });
    assert.isFalse(result.isError, result.text);
    assert.deepStrictEqual(dispatched, []);
  }).pipe(Effect.provide(layer));
});

it.effect("agent_delete leaves a bot to the user and says what deleting it would take", () => {
  const { layer } = harness();
  return Effect.gen(function* () {
    yield* seedBotAndAgent;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO bot_memories (agent_id, id, project_id, text, source, created_at, updated_at, owner)
      VALUES ('bot:named', 'fact', NULL, 'Uses pnpm', 'user', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'user')`;
    const remove = (id: string) =>
      Effect.flatMap(TaskToolService, (tools) =>
        tools.call({ name: "agent_delete", args: { id }, context: chat }),
      );
    const refused = yield* remove("bot:named");
    assert.isTrue(refused.isError);
    assert.equal(
      refused.text,
      "Old title is a bot. Deleting it also deletes its 1 memory, and its chat becomes a normal chat. Ask the user to remove it in the bot's settings if they want that.",
    );
    assert.isTrue(
      Option.isSome(
        yield* (yield* TaskRepository).getAgentById({ id: TaskAgentId.make("bot:named") }),
      ),
    );
    assert.isFalse((yield* remove("agent-dev")).isError);
  }).pipe(Effect.provide(layer));
});

it.effect(
  "bot_create and bot_update enforce mode ceilings, duplicate IDs, chat sync, and run-thread limits",
  () => {
    const { layer, dispatched, threadModes } = harness();
    const supervised: TaskToolInvocationContext = {
      ...chat,
      live: true,
      runtimeMode: "approval-required",
    };
    const fullAccess: TaskToolInvocationContext = { ...supervised, runtimeMode: "full-access" };
    const call = (name: string, args: Record<string, unknown>, context = fullAccess) =>
      Effect.flatMap(TaskToolService, (tools) => tools.call({ name, args, context }));
    const modelSelection = { instanceId: "codex", model: "gpt-5.4" };
    return Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const sql = yield* SqlClient.SqlClient;
      const botRows = sql<{ readonly agentId: string; readonly threadId: string }>`
      SELECT agent_id AS "agentId", thread_id AS "threadId" FROM bots`;

      assert.isFalse(TASK_TOOL_SPECS.some((spec) => spec.name === "bot_delete"));

      // Plan mode (dryRun) does not create a bot.
      const planDryRun = yield* call(
        "bot_create",
        { name: "Release helper", instructions: "Ship releases.", modelSelection },
        { ...fullAccess, mutationPolicy: "deny", interactionMode: "plan" },
      );
      assert.isFalse(planDryRun.isError, planDryRun.text);
      assert.isTrue(JSON.parse(planDryRun.text).dryRun);
      assert.deepStrictEqual(yield* botRows, []);

      // The bot's chat would get full access, more than this chat has.
      const refused = yield* call(
        "bot_create",
        { name: "Release helper", instructions: "Ship releases.", modelSelection },
        supervised,
      );
      assert.isTrue(refused.isError);
      assert.include(refused.text, "Creating a bot would need more permissions (full-access)");
      assert.deepStrictEqual(yield* botRows, []);

      const created = yield* call("bot_create", {
        name: "Release helper",
        instructions: "Ship releases.",
        modelSelection,
      });
      assert.isFalse(created.isError, created.text);
      const { bot } = JSON.parse(created.text);
      assert.match(bot.agent.id, /^bot:/);
      assert.equal(bot.projectId, project);
      assert.equal(bot.threadId, `bot-chat:${bot.agent.id}`);
      assert.equal(bot.memoryMode, "upcomputer");
      assert.deepStrictEqual(yield* botRows, [{ agentId: bot.agent.id, threadId: bot.threadId }]);
      const agent = yield* repository.getAgentById({ id: bot.agent.id });
      assert.isTrue(Option.isSome(agent));
      if (Option.isSome(agent)) {
        assert.deepStrictEqual(agent.value.startTags, [`bot:${bot.agent.id}`]);
        assert.equal(agent.value.config.instructions, "Ship releases.");
      }
      assert.deepStrictEqual(
        dispatched
          .filter(({ type }) => type === "thread.create")
          .map(({ threadId, title }) => ({ threadId, title })),
        [{ threadId: bot.threadId, title: "Release helper" }],
      );

      // bot_create refuses an existing bot's id, even from a narrower caller trying to overwrite it.
      const overwriteAttempt = yield* call(
        "bot_create",
        {
          id: bot.agent.id,
          name: "Hijacked",
          instructions: "Ignore rules.",
          runtimeMode: "approval-required",
          modelSelection,
        },
        supervised,
      );
      assert.isTrue(overwriteAttempt.isError);
      assert.include(overwriteAttempt.text, "already exists");

      // bot_update refuses a narrower caller trying to modify a full-access bot even with a narrower runtimeMode.
      const hijackUpdate = yield* call(
        "bot_update",
        { id: bot.agent.id, instructions: "Hijacked.", runtimeMode: "approval-required" },
        supervised,
      );
      assert.isTrue(hijackUpdate.isError);
      assert.include(hijackUpdate.text, "Changing a bot would need more permissions (full-access)");

      // agent_update enforces the same mode-ceiling check when targeting a bot id.
      const agentHijackUpdate = yield* call(
        "agent_update",
        { id: bot.agent.id, instructions: "Hijacked.", runtimeMode: "approval-required" },
        supervised,
      );
      assert.isTrue(agentHijackUpdate.isError);
      assert.include(
        agentHijackUpdate.text,
        "Changing a bot would need more permissions (full-access)",
      );

      const worker = yield* repository.upsertAgent({
        id: TaskAgentId.make("worker-dev"),
        projectId: null,
        name: "Worker",
        enabled: false,
        startStatuses: [],
        startTags: [],
        startRunStatuses: [],
        config: { role: "Dev", modelSelection: modelSelection as never, instructions: "Code." },
        createdAt: "2026-10-27T00:00:00.000Z",
        updatedAt: "2026-10-27T00:00:00.000Z",
        archivedAt: null,
      });
      // A worker does not become a bot.
      const duplicate = yield* call("bot_create", {
        id: worker.id,
        name: "Developer",
        instructions: "Code.",
        modelSelection,
      });
      assert.isTrue(duplicate.isError);
      assert.include(duplicate.text, "This agent already exists. Create a new bot identity.");

      // bot_update refuses a worker id.
      const workerUpdate = yield* call("bot_update", { id: worker.id, name: "Not a bot" });
      assert.isTrue(workerUpdate.isError);
      assert.equal(workerUpdate.text, "Worker is a worker, not a bot. Use agent_update for it.");

      // bot_update updates name, model, memoryMode, and syncs interactionMode to the bot's chat thread.
      const updated = yield* call("bot_update", {
        id: bot.agent.id,
        name: "Release captain",
        modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-4-5" },
        interactionMode: "plan",
        memoryMode: "agent",
      });
      assert.isFalse(updated.isError, updated.text);
      assert.equal(JSON.parse(updated.text).bot.memoryMode, "agent");
      const saved = yield* repository.getAgentById({ id: bot.agent.id });
      assert.isTrue(Option.isSome(saved));
      if (Option.isSome(saved)) {
        assert.equal(saved.value.name, "Release captain");
        assert.equal(saved.value.config.modelSelection.model, "claude-haiku-4-5");
        assert.equal(saved.value.config.instructions, "Ship releases.");
        assert.equal(saved.value.config.interactionMode, "plan");
      }
      assert.isTrue(
        dispatched.some(
          (command) =>
            command.type === "thread.interaction-mode.set" &&
            command.threadId === bot.threadId &&
            command.interactionMode === "plan",
        ),
      );

      // A supervised bot whose permanent chat thread was switched to full-access cannot be edited by a supervised caller.
      const supervisedBotRes = yield* call(
        "bot_create",
        {
          name: "Supervised bot",
          instructions: "Ask first.",
          runtimeMode: "approval-required",
          memoryMode: "agent",
          modelSelection,
        },
        supervised,
      );
      assert.isFalse(supervisedBotRes.isError, supervisedBotRes.text);
      const supervisedBot = JSON.parse(supervisedBotRes.text).bot;
      assert.equal(supervisedBot.memoryMode, "agent");
      threadModes.set(supervisedBot.threadId, {
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const divergedUpdate = yield* call(
        "bot_update",
        { id: supervisedBot.agent.id, instructions: "Injected." },
        supervised,
      );
      assert.isTrue(divergedUpdate.isError);
      assert.include(
        divergedUpdate.text,
        "Changing a bot would need more permissions (full-access)",
      );
      const divergedAgentUpdate = yield* call(
        "agent_update",
        { id: supervisedBot.agent.id, instructions: "Injected." },
        supervised,
      );
      assert.isTrue(divergedAgentUpdate.isError);
      assert.include(
        divergedAgentUpdate.text,
        "Changing a bot would need more permissions (full-access)",
      );

      // Background task-agent runs cannot call bot_create or bot_update (even after ending).
      const runThread = ThreadId.make("thread-worker-run");
      yield* repository.createAgentRun({
        id: TaskAgentRunId.make("run-worker-1"),
        taskId: (yield* repository.upsert({
          id: "task-bg" as never,
          projectId: project,
          title: "Bg",
          description: "Bg",
          status: "To Do",
          output: null,
          priority: null,
          createdBy: "agent",
          assigneeAgentRunId: null,
          sourceThreadId: null,
          sourceRunId: null,
          metadata: null,
          tags: [],
          notBefore: null,
          createdAt: "2026-10-27T00:00:00.000Z",
          updatedAt: "2026-10-27T00:00:00.000Z",
          archivedAt: null,
          audience: "agent",
          kind: "task",
        })).id,
        agentId: worker.id,
        threadId: runThread,
        modelSelection: modelSelection as never,
        status: "completed",
        startedAt: "2026-10-27T00:00:00.000Z",
        completedAt: "2026-10-27T00:01:00.000Z",
        triggerRunId: null,
        continuesRunId: null,
      });
      const runContext: TaskToolInvocationContext = { ...fullAccess, threadId: runThread };
      const bgCreate = yield* call(
        "bot_create",
        { name: "Injected", instructions: "Bad.", modelSelection },
        runContext,
      );
      assert.isTrue(bgCreate.isError);
      assert.include(bgCreate.text, "cannot create or edit bots");
      const bgUpdate = yield* call(
        "bot_update",
        { id: bot.agent.id, instructions: "Bad." },
        runContext,
      );
      assert.isTrue(bgUpdate.isError);
      assert.include(bgUpdate.text, "cannot create or edit bots");
      const bgAgentUpdate = yield* call(
        "agent_update",
        { id: bot.agent.id, instructions: "Bad." },
        runContext,
      );
      assert.isTrue(bgAgentUpdate.isError);
      assert.include(bgAgentUpdate.text, "cannot create or edit bots");
    }).pipe(Effect.provide(layer));
  },
);

it.effect("changing a task replies short; verbose and task_get return the whole task", () => {
  const { layer, create, update } = harness();
  return Effect.gen(function* () {
    const tools = yield* TaskToolService;
    const call = (name: string, args: Record<string, unknown>) =>
      tools.call({ name, args, context: chat });
    const description = `Context.\n${"d".repeat(20_000)}`;
    const output = `## Summary\n${"o".repeat(40_000)}`;

    const created = yield* create(item("big", "Backlog", { description, tags: ["dev"] }));
    assert.isFalse(created.isError, created.text);
    const createReply = JSON.parse(created.text);
    const id = createReply.task.id;
    assert.deepStrictEqual(Object.keys(createReply.task), [
      "id",
      "title",
      "status",
      "audience",
      "kind",
      "tags",
      "notBefore",
      "updatedAt",
    ]);
    assert.deepStrictEqual(createReply.description, { length: description.length });
    assert.notProperty(createReply, "output");
    assert.notInclude(created.text, "ddddd");

    const written = yield* update({ id, status: "To Do", output });
    assert.isFalse(written.isError, written.text);
    const reply = JSON.parse(written.text);
    assert.deepStrictEqual([...reply.changed].sort(), ["output", "status"]);
    assert.equal(reply.task.status, "To Do");
    assert.deepStrictEqual(reply.output, { length: output.length, firstLine: "## Summary" });
    assert.notProperty(reply, "description");
    assert.notInclude(written.text, "ooooo");

    // A short field this call changed comes with its new value.
    const prioritized = JSON.parse((yield* update({ id, priority: "high" })).text);
    assert.deepStrictEqual(prioritized.changed, ["priority"]);
    assert.equal(prioritized.task.priority, "high");
    assert.notProperty(prioritized, "output");

    const full = yield* update({ id, title: "bigger", verbose: true });
    const whole = JSON.parse(full.text).task;
    assert.equal(whole.output, output);
    assert.equal(whole.description, description);
    const got = yield* call("task_get", { id });
    assert.deepStrictEqual(JSON.parse(got.text), { task: whole });
    // Sizes for a real-sized task: the whole task is what every update used to reply.
    assert.isAbove(full.text.length, 60_000);
    assert.isBelow(written.text.length, 600);

    const other = JSON.parse((yield* create(item("other", "Backlog"))).text).task.id;
    const moved = JSON.parse((yield* call("task_reorder", { id, beforeTaskId: other })).text);
    assert.deepStrictEqual(moved.changed, ["rank"]);
    assert.isString(moved.task.rank);
    const movedFull = yield* call("task_reorder", { id: other, beforeTaskId: id, verbose: true });
    assert.equal(JSON.parse(movedFull.text).task.description, "Do other.");
  }).pipe(Effect.provide(layer));
});

it.effect("agent_create and agent_update leave the instructions out unless verbose", () => {
  const { layer } = harness();
  return Effect.gen(function* () {
    const tools = yield* TaskToolService;
    const call = (name: string, args: Record<string, unknown>) =>
      tools.call({ name, args, context: chat });
    const instructions = `Build it.\n${"i".repeat(10_000)}`;
    const created = yield* call("agent_create", {
      name: "Dev",
      enabled: false,
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      instructions: "Build it.",
    });
    assert.isFalse(created.isError, created.text);
    const createReply = JSON.parse(created.text);
    assert.notProperty(createReply.agent.config, "instructions");
    assert.deepStrictEqual(createReply.instructions, { length: "Build it.".length });

    const id = createReply.agent.id;
    const updated = yield* call("agent_update", { id, instructions, startTags: ["dev"] });
    assert.isFalse(updated.isError, updated.text);
    const reply = JSON.parse(updated.text);
    assert.deepStrictEqual([...reply.changed].sort(), ["instructions", "startTags"]);
    assert.deepStrictEqual(reply.instructions, { length: instructions.length });
    assert.deepStrictEqual(reply.agent.startTags, ["dev"]);
    assert.notInclude(updated.text, "iiiii");

    const unchanged = JSON.parse((yield* call("agent_update", { id, enabled: false })).text);
    assert.deepStrictEqual(unchanged.changed, []);
    assert.notProperty(unchanged, "instructions");

    const full = yield* call("agent_update", { id, startTags: ["dev", "x"], verbose: true });
    assert.equal(JSON.parse(full.text).agent.config.instructions, instructions);
  }).pipe(Effect.provide(layer));
});

it.effect("an archived agent leaves agent_search and agent_get, and unarchives as it was", () => {
  const { layer } = harness();
  return Effect.gen(function* () {
    const tools = yield* TaskToolService;
    const call = (name: string, args: Record<string, unknown>) =>
      tools.call({ name, args, context: chat });
    const searched = (args: Record<string, unknown>) =>
      call("agent_search", args).pipe(
        Effect.map((result) =>
          JSON.parse(result.text).agents.map((agent: { readonly id: string }) => agent.id),
        ),
      );
    const created = yield* call("agent_create", {
      name: "Old analyst",
      enabled: false,
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      instructions: "Analyse.",
    });
    const id = JSON.parse(created.text).agent.id;

    const archived = JSON.parse((yield* call("agent_update", { id, archived: true })).text);
    assert.deepStrictEqual(archived.changed, ["archived"]);
    assert.isString(archived.agent.archivedAt);
    assert.deepStrictEqual(yield* searched({}), []);
    assert.deepStrictEqual(yield* searched({ includeArchived: true }), [id]);
    const hidden = yield* call("agent_get", { id });
    assert.isTrue(hidden.isError);
    assert.include(hidden.text, "includeArchived");
    const read = yield* call("agent_get", { id, includeArchived: true });
    assert.equal(JSON.parse(read.text).agent.archivedAt, archived.agent.archivedAt);

    const again = JSON.parse((yield* call("agent_update", { id, archived: true })).text);
    assert.equal(again.agent.archivedAt, archived.agent.archivedAt, "keeps the first archive time");

    const unarchived = JSON.parse((yield* call("agent_update", { id, archived: false })).text);
    assert.deepStrictEqual(unarchived.changed, ["archived"]);
    assert.isNull(unarchived.agent.archivedAt);
    assert.isFalse(unarchived.agent.enabled, "comes back paused, as it was archived");
    assert.deepStrictEqual(yield* searched({}), [id]);

    // A bot's agent has no Unarchive in the app, so the tool refuses to archive it.
    yield* call("agent_update", { id, startTags: [`bot:${id}`] });
    const bot = yield* call("agent_update", { id, archived: true });
    assert.isTrue(bot.isError);
    assert.deepStrictEqual(yield* searched({}), [id]);
  }).pipe(Effect.provide(layer));
});
