import { assert, it } from "@effect/vitest";
import { MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  BOT_MEMORY_CONTEXT_BUDGET,
  botMemoryContext,
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
} from "@t3tools/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import type { TurnContextInput } from "../../../../apps/server/src/orchestration-v2/TurnContext.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { BotService, layer as BotServiceLayer, type MemoryPage } from "./BotService.ts";

const timestamp = "2026-10-23T10:00:00.000Z";
interface Dispatched {
  readonly type: string;
  readonly runtimeMode?: string | undefined;
  readonly threadId?: string | undefined;
  readonly notification?:
    | { readonly summary: string; readonly source: { readonly kind: string } }
    | undefined;
}
const project = ProjectId.make("project-bot");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const config = { role: "Assistant", modelSelection, instructions: "Help." };
const botId = TaskAgentId.make("bot:seeded");
const botThread = ThreadId.make("bot-chat:seeded");
const plainThread = ThreadId.make("thread-plain");
const taskThread = ThreadId.make("thread-task-run");

/**
 * A bot service on a fresh task database. Thread dispatches wait on `gate`, so a test can hold
 * a bot save inside the service while it starts turns.
 */
const harness = Effect.gen(function* () {
  const entered = yield* Deferred.make<void>();
  const gate = yield* Deferred.make<void>();
  const dispatched: Array<Dispatched> = [];
  const threads = Layer.mock(ThreadManagementService)({
    hasReceipt: () => Effect.succeed(false),
    dispatch: (command) =>
      Deferred.succeed(entered, void dispatched.push(command)).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.as({} as never),
      ),
    getThreadRecords: (threadId: ThreadId) =>
      Effect.succeed({
        thread: { id: threadId, title: "Saved bot", projectId: project, modelSelection },
        runs: [],
        runtimeRequests: [],
      } as never),
  });
  const database = Layer.effectDiscard(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
  ).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));
  const services = BotServiceLayer.pipe(
    Layer.provideMerge(TaskRepositoryLive),
    Layer.provideMerge(database),
    Layer.provide(threads),
    Layer.provide(
      Layer.mock(ProjectStoreV2)({ getShell: () => Effect.succeed(Option.some({} as never)) }),
    ),
    Layer.provide(Layer.mock(TaskAgentService)({ scheduleTaskChanged: () => Effect.void })),
    Layer.provide(
      Layer.succeed(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => new Uint8Array(size),
          digest: () => Effect.die("unused digest"),
        }),
      ),
    ),
  );
  return { entered, gate, dispatched, services };
});

const seedBot = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const sql = yield* SqlClient.SqlClient;
  yield* repository.upsertAgent({
    id: botId,
    projectId: null,
    name: "Seeded bot",
    enabled: true,
    startStatuses: ["To Do"],
    startTags: [],
    startRunStatuses: [],
    config,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json, adopted)
    VALUES (${botId}, ${botThread}, ${project}, ${JSON.stringify([project])}, 0)`;
});

/** A run of an ordinary task agent, so its thread resolves through the run lookup. */
const seedTaskRun = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const agentId = TaskAgentId.make("plain-agent");
  const taskId = TaskId.make("task-plain");
  yield* repository.upsertAgent({
    id: agentId,
    projectId: project,
    name: "Plain agent",
    enabled: true,
    startStatuses: ["To Do"],
    startTags: [],
    startRunStatuses: [],
    config,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  yield* repository.upsert({
    id: taskId,
    projectId: project,
    title: "Plain task",
    description: "",
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
  });
  yield* repository.createAgentRun({
    id: TaskAgentRunId.make("run-plain"),
    taskId,
    agentId,
    threadId: taskThread,
    modelSelection,
    status: "running",
    startedAt: timestamp,
    completedAt: null,
    triggerRunId: null,
    continuesRunId: null,
  });
});

let messages = 0;
const turn = (
  threadId: ThreadId,
  text: string,
  createdBy: TurnContextInput["createdBy"] = "user",
): TurnContextInput => ({
  threadId,
  projectId: project,
  messageId: MessageId.make(`message-${++messages}`),
  text,
  createdBy,
});

const run = <A, E>(body: Effect.Effect<A, E, BotService | TaskRepository | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const { services } = yield* harness;
    return yield* body.pipe(Effect.provide(services));
  });

/** Like `run`, with thread commands going through at once and recorded. */
const runRecorded = <A, E>(
  body: (
    dispatched: ReadonlyArray<Dispatched>,
  ) => Effect.Effect<A, E, BotService | TaskRepository | SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    const { gate, dispatched, services } = yield* harness;
    yield* Deferred.succeed(gate, undefined);
    return yield* body(dispatched).pipe(Effect.provide(services));
  });

const newBot = (runtimeMode?: "approval-required" | "full-access") => ({
  id: TaskAgentId.make("bot:new"),
  projectId: project,
  allowedProjectIds: [project],
  name: "New bot",
  config: runtimeMode === undefined ? config : { ...config, runtimeMode },
});
const runtimeModes = (dispatched: ReadonlyArray<Dispatched>) =>
  dispatched.flatMap((command) => (command.runtimeMode === undefined ? [] : [command.runtimeMode]));

it.effect("threads that belong to no bot get no context, also with no bots at all", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      assert.deepStrictEqual(yield* bots.context(turn(plainThread, "remember: x")), { text: "" });
      yield* seedBot;
      yield* seedTaskRun;
      for (const threadId of [plainThread, taskThread])
        assert.deepStrictEqual(yield* bots.context(turn(threadId, "remember: x")), { text: "" });
      assert.include((yield* bots.context(turn(botThread, "Hello"))).text, "<upcomputer_bot>");
    }),
  ),
);

it.effect("bot context describes the bot by its instructions, not the hidden stored role", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      const { text } = yield* bots.context(turn(botThread, "Hello"));
      assert.include(text, "Instructions:\nHelp.");
      assert.notInclude(text, config.role);
    }),
  ),
);

it.effect("turn starts never wait on a bot save, in bot chats or anywhere else", () =>
  Effect.gen(function* () {
    const { entered, gate, services } = yield* harness;
    yield* Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      yield* seedTaskRun;
      // The save stops inside its first thread dispatch, holding the bot write lock.
      const saving = yield* bots
        .save({
          id: TaskAgentId.make("bot:new"),
          projectId: project,
          allowedProjectIds: [project],
          name: "New bot",
          config,
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      for (const threadId of [plainThread, taskThread]) {
        const context = yield* bots.context(turn(threadId, "Hello"));
        assert.deepStrictEqual(context, { text: "" });
      }
      const botTurn = yield* bots.context(turn(botThread, "remember: user likes tea"));
      assert.isDefined(botTurn.marker);
      assert.deepStrictEqual(
        (yield* bots.memory(botId)).map((entry) => entry.text),
        ["user likes tea"],
      );
      yield* Deferred.succeed(gate, undefined);
      assert.equal((yield* Fiber.join(saving)).agent.name, "New bot");
    }).pipe(Effect.provide(services));
  }),
);

it.effect("a failed bot lookup does not stop the turn", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      const sql = yield* SqlClient.SqlClient;
      yield* seedBot;
      yield* sql`ALTER TABLE bots RENAME TO bots_unreadable`;
      assert.deepStrictEqual(yield* bots.context(turn(plainThread, "Hello")), { text: "" });
    }),
  ),
);

it.effect("only a person's message that starts with remember and a colon saves memory", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      const saved = Effect.map(bots.memory(botId), (entries) => entries.map((entry) => entry.text));
      yield* bots.context(turn(botThread, "Remember when we fixed the build?"));
      yield* bots.context(turn(botThread, "remember the deploy failing yesterday?"));
      yield* bots.context(turn(botThread, "Remember: agent fact", "agent"));
      yield* bots.context(turn(botThread, "Remember: system fact", "system"));
      assert.deepStrictEqual(yield* saved, []);
      yield* bots.context(turn(botThread, "remember: user likes tea"));
      assert.deepStrictEqual(yield* saved, ["user likes tea"]);
      yield* bots.context(turn(botThread, "Запомни : ключ в ящике"));
      assert.sameMembers(yield* saved, ["user likes tea", "ключ в ящике"]);
    }),
  ),
);

it.effect("a new bot and its chat get full access, like a new thread", () =>
  runRecorded((dispatched) =>
    Effect.gen(function* () {
      const bots = yield* BotService;
      const bot = yield* bots.save(newBot());
      assert.equal(bot.agent.config.runtimeMode, "full-access");
      assert.deepStrictEqual(runtimeModes(dispatched), ["full-access"]);
    }),
  ),
);

it.effect("a bot saved before permissions were stored recovers its chat with full access", () =>
  runRecorded((dispatched) =>
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      yield* bots.recover;
      assert.deepStrictEqual(
        dispatched.map((command) => [command.type, command.runtimeMode]),
        [["thread.create", "full-access"]],
      );
    }),
  ),
);

it.effect("an explicit Supervised choice is kept, and a changed one moves the chat", () =>
  runRecorded((dispatched) =>
    Effect.gen(function* () {
      const bots = yield* BotService;
      const created = yield* bots.save(newBot("approval-required"));
      assert.equal(created.agent.config.runtimeMode, "approval-required");
      // Another settings save sends the stored config back unchanged.
      const resaved = yield* bots.save({ ...newBot(), config: created.agent.config });
      assert.equal(resaved.agent.config.runtimeMode, "approval-required");
      // The mock has no command receipts, so every save sends the chat's create again.
      const modeChanges = () =>
        runtimeModes(dispatched.filter((command) => command.type === "thread.runtime-mode.set"));
      assert.deepStrictEqual(new Set(runtimeModes(dispatched)), new Set(["approval-required"]));
      assert.deepStrictEqual(modeChanges(), []);
      yield* bots.save(newBot("full-access"));
      assert.deepStrictEqual(modeChanges(), ["full-access"]);
    }),
  ),
);

it.effect("the bot chat delegates through task agents; a background run does not", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      const chat = (yield* bots.context(turn(botThread, "Hello"))).text;
      assert.include(chat, "call task_context first");
      assert.include(chat, "then task_create");
      assert.include(chat, "Use bot_assign only for work you should do yourself");
      const repository = yield* TaskRepository;
      const task = yield* bots.assign({
        agentId: botId,
        requestId: "request-1",
        title: "Background",
        description: "",
      });
      yield* repository.createAgentRun({
        id: TaskAgentRunId.make("run-bot"),
        taskId: task.id,
        agentId: botId,
        threadId: taskThread,
        modelSelection,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        triggerRunId: null,
        continuesRunId: null,
      });
      const background = (yield* bots.context(turn(taskThread, "Work"))).text;
      assert.notInclude(background, "task_create");
      assert.include(background, "This is a background task run");
    }),
  ),
);

it.effect("bot_assign tasks report to the bot chat and count in its run counts", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      const repository = yield* TaskRepository;
      yield* seedBot;
      const task = yield* bots.assign({
        agentId: botId,
        requestId: "request-1",
        title: "Background",
        description: "",
      });
      const stored = yield* repository.getById({ id: task.id });
      assert.isTrue(Option.isSome(stored));
      if (Option.isNone(stored)) return;
      assert.equal(stored.value.sourceThreadId, botThread);
      assert.equal(stored.value.rootThreadId, botThread);
      yield* repository.createAgentRun({
        id: TaskAgentRunId.make("run-bot"),
        taskId: task.id,
        agentId: botId,
        threadId: taskThread,
        modelSelection,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        triggerRunId: null,
        continuesRunId: null,
      });
      const counts = yield* repository.threadRunCounts({ threadIds: [botThread] });
      assert.deepStrictEqual(counts.threads[0]?.runCounts, [{ status: "running", count: 1 }]);
    }),
  ),
);

/** A memory saved before the test clock's now, `minute` ordering it by recency. */
const seedMemory = (
  id: string,
  text: string,
  options: {
    readonly minute: number;
    readonly projectId?: ProjectId | null;
    readonly owner?: "user" | "bot";
  },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const at = `1969-12-31T23:${String(options.minute).padStart(2, "0")}:00.000Z`;
    const projectId = options.projectId === undefined ? project : options.projectId;
    yield* sql`INSERT INTO bot_memories (agent_id, id, project_id, text, source, created_at, updated_at, owner)
      VALUES (${botId}, ${id}, ${projectId}, ${text}, 'chat:seed', ${at}, ${at}, ${options.owner ?? "bot"})`;
  });
/** Ten entries for the working project and global, about 2000 characters each for most. */
const overfill = Effect.gen(function* () {
  yield* seedBot;
  yield* seedMemory("user-fact", "The user prefers short answers", { minute: 0, owner: "user" });
  for (let index = 10; index < 18; index += 1)
    yield* seedMemory(`big-${index}`, `${index} `.repeat(633).trim(), { minute: index });
  yield* seedMemory("global-fact", "A small global fact", { minute: 50, projectId: null });
  yield* seedMemory("elsewhere", "Another project's fact", {
    minute: 51,
    projectId: ProjectId.make("project-other"),
  });
});
/** The JSON data line right before a context block's closing tag. */
const dataLine = (text: string, tag: string) => {
  const lines = text.split("\n");
  return lines[lines.indexOf(`</${tag}>`) - 1]!;
};
const ids = (entries: ReadonlyArray<{ readonly id: string }>) => entries.map((entry) => entry.id);

it.effect("the snapshot says how much memory it shows, the user's entries first", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* overfill;
      const { text } = yield* bots.context(turn(botThread, "Hello"));
      const line = dataLine(text, "upcomputer_bot");
      const shown: ReadonlyArray<{ id: string; owner: string; scope: string }> = JSON.parse(line);
      assert.isAtMost(line.length, BOT_MEMORY_CONTEXT_BUDGET);
      assert.deepStrictEqual(ids(shown), [
        "user-fact",
        "big-17",
        "big-16",
        "big-15",
        "big-14",
        "big-13",
        // The large entries left over do not stop a small one that still fits.
        "global-fact",
      ]);
      assert.deepStrictEqual(shown[0], {
        ...shown[0]!,
        owner: "user",
        scope: "project",
      });
      assert.include(
        text,
        `Showing 7 of 10 memories (${line.length} of ${BOT_MEMORY_CONTEXT_BUDGET} characters). The rest is available through bot_memory.`,
      );
      // The bot page marks entries with the same selection.
      assert.deepStrictEqual(
        ids(botMemoryContext(yield* bots.memory(botId), project).selected),
        ids(shown),
      );
    }),
  ),
);

it.effect("an entry the budget left out reaches the model once it fits", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* overfill;
      const first = yield* bots.context(turn(botThread, "Hello"));
      yield* TestClock.adjust("1 second");
      yield* bots.forget(botId, "big-17", "user");
      yield* TestClock.adjust("1 second");
      const second = yield* bots.context({
        ...turn(botThread, "Next"),
        deliveredMarker: first.marker!,
      });
      assert.isDefined(second.update);
      const changes: { updated: ReadonlyArray<{ id: string }>; removed: ReadonlyArray<string> } =
        JSON.parse(dataLine(second.update!, "memory_update"));
      assert.deepStrictEqual(changes.removed, ["big-17"]);
      assert.deepStrictEqual(ids(changes.updated), ["big-12"]);
      assert.include(second.update!, "A fresh snapshot would now show 7 of 9 memories");
      yield* TestClock.adjust("1 second");
      const third = yield* bots.context({
        ...turn(botThread, "Again"),
        deliveredMarker: second.marker!,
      });
      assert.equal(third.update, "");
    }),
  ),
);

it.effect("bot_memory pages are bounded and cover every entry once", () =>
  run(
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* overfill;
      for (let index = 20; index < 40; index += 1)
        yield* seedMemory(`small-${index}`, `fact ${index}`, { minute: index, projectId: null });
      const seen: Array<string> = [];
      let offset: number | null = 0;
      let pages = 0;
      while (offset !== null) {
        const page: MemoryPage = yield* bots.memoryPage(botId, project, offset);
        assert.equal(page.total, 30);
        assert.isAtMost(JSON.stringify(page.entries).length, 12000 + 50);
        seen.push(...ids(page.entries));
        offset = page.nextOffset;
        pages += 1;
      }
      assert.isAbove(pages, 1);
      assert.deepStrictEqual(
        seen,
        ids(botMemoryContext(yield* bots.memory(botId), project).entries),
      );
      const first = yield* bots.memoryPage(botId, project, 0);
      assert.deepStrictEqual(
        first.entries.filter((entry) => entry.inContext).map((entry) => entry.id),
        ids(botMemoryContext(yield* bots.memory(botId), project).selected).filter((id) =>
          ids(first.entries).includes(id),
        ),
      );
    }),
  ),
);

it.effect("the bot cannot change or forget the user's entries; the user can", () =>
  runRecorded(() =>
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      const write = (id: string, text: string) => ({
        agentId: botId,
        id,
        projectId: project,
        text,
        source: "user",
      });
      yield* bots.remember(write("mine", "Deploys go out on Fridays"), "user");
      const refused = yield* bots
        .remember(write("mine", "Deploys go out on Mondays"), "bot")
        .pipe(Effect.flip);
      assert.include(refused.message, "Ask the user");
      assert.include(
        (yield* bots.forget(botId, "mine", "bot").pipe(Effect.flip)).message,
        "Ask the user",
      );
      const text = Effect.map(bots.memory(botId), (entries) => entries.map((entry) => entry.text));
      assert.deepStrictEqual(yield* text, ["Deploys go out on Fridays"]);
      yield* bots.remember(write("mine", "Deploys go out on Mondays"), "user");
      assert.deepStrictEqual(yield* text, ["Deploys go out on Mondays"]);
      // A bot entry the user edits becomes the user's.
      yield* bots.remember(write("bots", "Tests run in CI"), "bot");
      yield* bots.remember(write("bots", "Tests run in CI and locally"), "user");
      assert.equal((yield* bots.memory(botId)).find((entry) => entry.id === "bots")?.owner, "user");
      yield* bots.forget(botId, "mine", "user");
      assert.deepStrictEqual(yield* text, ["Tests run in CI and locally"]);
    }),
  ),
);

it.effect("the bot's memory changes and accepted suggestions show in its chat", () =>
  runRecorded((dispatched) =>
    Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      const write = (id: string, text: string, projectId: ProjectId | null = project) => ({
        agentId: botId,
        id,
        projectId,
        text,
        source: "chat:bot",
      });
      yield* bots.remember(write("fact", "Uses pnpm"), "bot");
      yield* TestClock.adjust("1 second");
      yield* bots.remember(write("fact", "Uses pnpm 11"), "bot");
      yield* TestClock.adjust("1 second");
      // Saving the same text again changes nothing worth showing.
      yield* bots.remember(write("fact", "Uses pnpm 11"), "bot");
      yield* bots.remember(write("other", "Main is protected"), "user");
      yield* bots.forget(botId, "fact", "bot");
      yield* bots.forget(botId, "other", "user");
      yield* bots.propose({ ...write("suggested", "Node 24"), runId: "run-1" });
      yield* bots.acceptProposal(botId, "proposal:run-1:suggested");
      const rows = dispatched.filter((command) => command.type === "thread.notification.record");
      assert.deepStrictEqual(
        rows.map((command) => command.notification?.summary),
        [
          "Saved: Uses pnpm",
          "Changed: Uses pnpm 11 (was: Uses pnpm)",
          "Forgotten: Uses pnpm 11",
          "Saved: Node 24",
        ],
      );
      assert.isTrue(
        rows.every(
          (command) =>
            command.threadId === botThread && command.notification?.source.kind === "memory",
        ),
      );
      assert.equal(
        (yield* bots.memory(botId)).find((entry) => entry.id === "suggested")?.owner,
        "user",
      );
    }),
  ),
);

it.effect("a remember message is the user's entry and shows in the chat", () =>
  Effect.gen(function* () {
    const { entered, services } = yield* harness;
    yield* Effect.gen(function* () {
      const bots = yield* BotService;
      yield* seedBot;
      const { text } = yield* bots.context(turn(botThread, "Remember: the staging host is blue"));
      // The model is told, so it does not save the same fact a second time.
      assert.include(text, "is already saved as memory");
      // The row is recorded off the turn start; the first thread command is that row.
      yield* Deferred.await(entered);
      const [entry] = yield* bots.memory(botId);
      assert.equal(entry?.owner, "user");
    }).pipe(Effect.provide(services));
  }),
);
