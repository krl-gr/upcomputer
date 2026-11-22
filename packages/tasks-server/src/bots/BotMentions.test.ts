import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  runExperimentalFeatureMigrations,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { BotMentions, layer as BotMentionsLayer } from "./BotMentions.ts";
import { BotService } from "./BotService.ts";

const project = ProjectId.make("project-bot");
const botId = TaskAgentId.make("bot:b");
const botThread = ThreadId.make("bot-chat:b");
/** Bot A's chat, from which the person asks bot B. */
const botAThread = ThreadId.make("bot-chat:a");
const messageId = MessageId.make("message-mention");
const runId = RunId.make("run-b");
const at = DateTime.makeUnsafe("2026-11-22T10:00:00.000Z");

interface Dispatched {
  readonly type: string;
  readonly threadId?: string;
  readonly notification?: {
    readonly outcome: string;
    readonly summary: string;
    readonly detail?: string;
    readonly source: { readonly kind: string; readonly step?: string };
  };
}
interface Sent {
  readonly threadId: string;
  readonly mode: string;
  readonly text: string;
}

const run = (status: string, id = runId) =>
  ({ id, threadId: botThread, userMessageId: messageId, status }) as never;
const runEvent = (type: "run.created" | "run.updated", payload: unknown) =>
  ({ type, threadId: botThread, payload }) as unknown as OrchestrationV2DomainEvent;

/** Bot mentions on a fresh task database, with the bot's chat and the origin faked. */
const harness = Effect.gen(function* () {
  const dispatched = yield* Queue.unbounded<Dispatched>();
  const sends: Array<Sent> = [];
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  /** What the bot's chat holds for the run: its runs, reply and error. */
  const chat = {
    runs: [] as Array<unknown>,
    reply: "Here is the answer." as string | undefined,
    error: undefined as string | undefined,
  };
  const threads = Layer.mock(ThreadManagementService)({
    streamDomainEvents: Stream.fromQueue(domainEvents),
    dispatch: (command) =>
      Queue.offer(dispatched, command as Dispatched).pipe(Effect.as({} as never)),
    sendToThread: (input) =>
      Effect.sync(() => {
        sends.push(input);
        return { run: { id: runId }, delivery: "started" } as never;
      }),
    getThreadRecords: (threadId: ThreadId) =>
      Effect.succeed({
        thread: { id: threadId, title: "Planning", projectId: project, deletedAt: null },
        runs: chat.runs,
        messages:
          chat.reply === undefined
            ? []
            : [{ runId, role: "assistant", text: chat.reply, createdAt: at, updatedAt: at }],
        turnItems:
          chat.error === undefined
            ? []
            : [{ runId, type: "error", ordinal: 1, failure: { message: chat.error } }],
      } as never),
    getTimelinePage: () =>
      Effect.succeed({
        items: [{ item: { type: "user_message", messageId: MessageId.make("origin-1") } }],
      } as never),
    getMessagesById: () =>
      Effect.succeed(
        new Map([
          [MessageId.make("origin-1"), { role: "user", text: "We pick a launch date." } as never],
        ]),
      ),
  });
  const bots = Layer.mock(BotService)({
    get: () => Effect.succeed({ agent: { id: botId, name: "Bea" }, threadId: botThread } as never),
  });
  const database = Layer.effectDiscard(
    runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
  ).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));
  const dependencies = Layer.mergeAll(threads, bots, database);
  /** A fresh service each time, as after a restart; only the database is shared. */
  const service = Layer.fresh(BotMentionsLayer);
  const notifications = Effect.gen(function* () {
    const command = yield* Queue.take(dispatched);
    assert.strictEqual(command.type, "thread.notification.record");
    return command;
  });
  return { sends, dispatched, domainEvents, chat, dependencies, service, notifications };
});

it.effect("posts the bot's reply in bot A's chat as a notification, so A does not run", () =>
  Effect.gen(function* () {
    const { sends, domainEvents, dependencies, service, notifications } = yield* harness;
    yield* Effect.gen(function* () {
      const mentions = yield* BotMentions;
      const relay = yield* Effect.forkChild(mentions.relay);
      const result = yield* mentions.mention({
        agentId: botId,
        threadId: botAThread,
        messageId,
        text: "When do we launch?",
      });
      assert.deepStrictEqual(result, { repliesHere: true });
      assert.deepStrictEqual(
        sends.map(({ threadId, mode, text }) => ({ threadId, mode, text })),
        [{ threadId: botThread, mode: "queue", text: "When do we launch?" }],
      );
      const sent = yield* notifications;
      assert.strictEqual(sent.threadId, botAThread);
      assert.strictEqual(sent.notification?.source.step, "sent");

      const note = yield* mentions.note({ threadId: botThread, messageId } as never);
      assert.include(note, `Thread "Planning" (${botAThread})`);
      assert.include(note, "User: We pick a launch date.");

      // Bot B is busy: its run waits in the queue, then answers.
      yield* Queue.offer(domainEvents, runEvent("run.created", run("queued")));
      yield* Queue.offer(domainEvents, runEvent("run.updated", run("queued")));
      yield* Queue.offer(domainEvents, runEvent("run.updated", run("completed")));
      const reply = yield* notifications;
      assert.strictEqual(reply.threadId, botAThread);
      assert.deepStrictEqual(reply.notification, {
        source: {
          kind: "bot_mention",
          agentId: botId,
          name: "Bea",
          botThreadId: botThread,
          step: "reply",
        },
        outcome: "completed",
        summary: "Bea replied",
        detail: "Here is the answer.",
      } as never);
      // Only bot B's chat ever got a message; A's chat got notifications, which start no turn.
      assert.deepStrictEqual(
        sends.map((send) => send.threadId),
        [botThread],
      );
      yield* Fiber.interrupt(relay);
    }).pipe(Effect.provide(service), Effect.provide(dependencies));
  }),
);

it.effect("tells the origin why the bot didn't reply when its run fails", () =>
  Effect.gen(function* () {
    const { chat, domainEvents, dependencies, service, notifications } = yield* harness;
    chat.reply = undefined;
    chat.error = "The model is overloaded.";
    yield* Effect.gen(function* () {
      const mentions = yield* BotMentions;
      const relay = yield* Effect.forkChild(mentions.relay);
      yield* mentions.mention({ agentId: botId, threadId: botAThread, messageId, text: "Hi" });
      yield* notifications;
      yield* Queue.offer(domainEvents, runEvent("run.updated", run("failed")));
      const reply = yield* notifications;
      assert.strictEqual(reply.notification?.outcome, "failed");
      assert.strictEqual(reply.notification?.summary, "Bea didn't reply");
      assert.strictEqual(reply.notification?.detail, "The model is overloaded.");
      yield* Fiber.interrupt(relay);
    }).pipe(Effect.provide(service), Effect.provide(dependencies));
  }),
);

it.effect("relays a reply that ended while the server was down from the saved link", () =>
  Effect.gen(function* () {
    const { chat, dispatched, dependencies, service, notifications } = yield* harness;
    yield* Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const mentions = yield* BotMentions;
        yield* mentions.mention({ agentId: botId, threadId: botAThread, messageId, text: "Hi" });
        yield* notifications;
      }).pipe(Effect.provide(service));
      // The run ended while nothing listened; a new start reads the link back and answers.
      chat.runs = [run("completed")];
      yield* Effect.gen(function* () {
        const mentions = yield* BotMentions;
        yield* mentions.recover;
        const reply = yield* notifications;
        assert.strictEqual(reply.threadId, botAThread);
        assert.strictEqual(reply.notification?.detail, "Here is the answer.");
        // Answered once: another start finds nothing pending.
        yield* mentions.recover;
        assert.strictEqual(yield* Queue.size(dispatched), 0);
      }).pipe(Effect.provide(service));
    }).pipe(Effect.provide(dependencies));
  }),
);

it.effect("treats a mention in the bot's own chat as an ordinary message", () =>
  Effect.gen(function* () {
    const { sends, dependencies, service } = yield* harness;
    yield* Effect.gen(function* () {
      const mentions = yield* BotMentions;
      const result = yield* mentions.mention({
        agentId: botId,
        threadId: botThread,
        messageId,
        text: "Hi",
      });
      assert.deepStrictEqual(result, { repliesHere: false });
      assert.strictEqual(sends.length, 1);
      assert.strictEqual(yield* mentions.note({ threadId: botThread, messageId } as never), "");
    }).pipe(Effect.provide(service), Effect.provide(dependencies));
  }),
);
