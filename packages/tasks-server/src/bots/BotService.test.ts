import { assert, it } from "@effect/vitest";
import { MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

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
import { BotService, layer as BotServiceLayer } from "./BotService.ts";

const timestamp = "2026-10-23T10:00:00.000Z";
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
  const dispatched: Array<{ readonly type: string; readonly runtimeMode?: string }> = [];
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
    dispatched: ReadonlyArray<{ readonly type: string; readonly runtimeMode?: string }>,
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
const runtimeModes = (dispatched: ReadonlyArray<{ readonly runtimeMode?: string }>) =>
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
