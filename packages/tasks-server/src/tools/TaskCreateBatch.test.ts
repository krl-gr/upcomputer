import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
  } as unknown as TaskAgentServiceShape;
  const database = Layer.effectDiscard(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
  ).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));
  const storage = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provideMerge(AllChatsInstructionsLive),
    Layer.provideMerge(
      Layer.mergeAll(
        database,
        NodeServices.layer,
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
      Layer.mergeAll(
        storage,
        Layer.succeed(TaskToolContextResolver, resolver),
        Layer.succeed(TaskAgentService, agents),
        Layer.succeed(ThreadManagementService, {} as never),
        Layer.succeed(ProjectStoreV2, {} as never),
        Layer.succeed(InboxProject, { ensure: Effect.succeed(inbox) }),
        Layer.succeed(TaskScheduleService, {} as never),
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
  const stored = Effect.gen(function* () {
    return yield* (yield* TaskRepository).search({ limit: 50, kind: "all" });
  });
  return { layer, scheduled, create, update, stored };
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

      const tasks = yield* stored;
      assert.deepStrictEqual(
        tasks.map(({ title }) => title),
        ["earlier", "first", "second", "third"],
      );
      const ranks = tasks.map(({ rank }) => rank);
      assert.deepStrictEqual(ranks, ranks.toSorted());
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
    assert.match(mixed.text, /Unable to resolve project. No task was created./);
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
