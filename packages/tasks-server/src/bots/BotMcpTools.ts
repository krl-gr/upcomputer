import { TurnItemId } from "@t3tools/contracts";
import { TaskError } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
// oxlint-disable-next-line t3code/no-raw-mcp-registration -- registers nothing: only hides memory tools and sends tools/list_changed
import { McpSchema, McpServer } from "effect/ai";
import {
  McpInvocationContext,
  McpToolAccess,
  registerToolSearchFilter,
  resultToolkitRegistration,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { agentRunModes, broaderRunMode } from "../agents/runModes.ts";
import { BotService } from "./BotService.ts";
import { BotToolkit } from "./BotToolDefinitions.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";

const handlers = McpToolAccess.toLayer(
  BotToolkit,
  Effect.gen(function* () {
    const bots = yield* BotService;
    const repository = yield* TaskRepository;
    const threads = yield* ThreadManagementService;
    const caller = Effect.fn("BotMcpTools.caller")(function* (write: boolean) {
      const invocation = yield* McpInvocationContext;
      if (!invocation.thread)
        return yield* new TaskError({ message: "This tool needs a bot's calling thread." });
      const { threadId } = invocation.thread;
      const bot = yield* bots.forThread(threadId);
      if (!bot) return yield* new TaskError({ message: "This chat does not belong to a bot." });
      const { thread } = yield* threads.getThreadRecords(threadId, []);
      if (write && thread.interactionMode === "plan")
        return yield* new TaskError({
          message: "Memory and task writes are unavailable in plan mode.",
        });
      if (bot.threadId !== threadId && thread.projectId !== bot.projectId)
        return yield* new TaskError({
          message: `This chat is in a project ${bot.agent.name} isn't set up for, so its memory and tasks are unavailable here. Ask the user to open the bot's settings and choose its working project again.`,
        });
      return { bot, thread };
    });
    const result = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.match({
          onFailure: (cause) =>
            new McpSchema.CallToolResult({
              isError: true,
              content: [
                {
                  type: "text",
                  // Agents read the plain sentence first, then the exact reason.
                  text:
                    cause instanceof TaskError
                      ? cause.message
                      : `Up.computer couldn't read or save the bot's data. Try again.${cause instanceof Error ? `\nDetails: ${cause.message}` : ""}`,
                },
              ],
            }),
          onSuccess: (value) =>
            new McpSchema.CallToolResult({
              content: [{ type: "text", text: JSON.stringify(value) }],
            }),
        }),
      );
    return {
      bot_memory: McpToolAccess.readsAsCaller((input) =>
        result(
          Effect.gen(function* () {
            const { bot } = yield* caller(false);
            return yield* bots.memoryPage(bot.agent.id, input.offset ?? 0);
          }),
        ),
      ),
      bot_remember: McpToolAccess.writes((input) =>
        result(
          Effect.gen(function* () {
            const { bot, thread } = yield* caller(true);
            // Task runs read untrusted pages and repositories; the bot's chat decides what stays.
            if (
              Option.isSome(yield* repository.findLatestAgentRunByThreadId({ threadId: thread.id }))
            )
              return yield* new TaskError({
                message:
                  "Background task runs cannot save memories. Put what is worth remembering in the run's result; the bot decides in its chat.",
              });
            return yield* bots.remember(
              {
                agentId: bot.agent.id,
                id: input.id,
                text: input.text,
                projectId: null,
                source: `chat:${thread.id}`,
              },
              "bot",
            );
          }),
        ),
      ),
      bot_forget: McpToolAccess.writes((input) =>
        result(
          Effect.gen(function* () {
            const { bot, thread } = yield* caller(true);
            if (
              Option.isSome(yield* repository.findLatestAgentRunByThreadId({ threadId: thread.id }))
            )
              return yield* new TaskError({
                message:
                  "Background task runs cannot remove memories. Ask the user in the bot's chat.",
              });
            yield* bots.forget(bot.agent.id, input.id, "bot");
            return { forgotten: input.id };
          }),
        ),
      ),
      bot_history_search: McpToolAccess.readsAsCaller((input) =>
        result(
          Effect.gen(function* () {
            const { bot } = yield* caller(false);
            const found = yield* threads.searchThread({
              threadId: bot.threadId,
              query: input.query,
              ...(input.index == null ? {} : { index: input.index }),
            });
            return {
              ...found,
              ...(found.match === null
                ? {}
                : {
                    page: yield* threads.getTimelinePage(bot.threadId, {
                      itemId: TurnItemId.make(found.match.entryId),
                      view: "messages",
                      limit: 20,
                    }),
                  }),
            };
          }),
        ),
      ),
      bot_assign: McpToolAccess.writes((input) =>
        result(
          Effect.gen(function* () {
            const { bot, thread } = yield* caller(true);
            if (thread.id !== bot.threadId)
              return yield* new TaskError({
                message: "Assign work from the bot's permanent chat.",
              });
            if (broaderRunMode(agentRunModes(bot.agent.config), thread) !== null)
              return yield* new TaskError({
                message: "The task would run in broader modes than this chat.",
              });
            return yield* bots.assign({ agentId: bot.agent.id, ...input });
          }),
        ),
      ),
    };
  }),
);
const memoryTools = new Set(["bot_memory", "bot_remember", "bot_forget"]);

/**
 * A bot whose agent keeps its own memory gets no memory tools, in its chat or its task runs: they
 * are hidden from lists and `tool_search`, and refused when called. Product tools take no local
 * middleware, so the check is global and passes every other tool at once.
 */
const memoryToolShown = (bots: BotService["Service"]) =>
  // Untraced: it runs once per tool on every list request.
  Effect.fnUntraced(function* (target: string) {
    if (!memoryTools.has(target)) return true;
    const scope = yield* Effect.serviceOption(McpInvocationContext);
    const thread = Option.getOrUndefined(scope)?.thread;
    if (thread === undefined) return true;
    return yield* bots.forThread(thread.threadId).pipe(
      Effect.map((bot) => bot?.memoryMode !== "agent"),
      Effect.orElseSucceed(() => true),
    );
  });

const MemoryToolVisibility = Layer.mergeAll(
  McpServer.visibility(
    Effect.map(BotService, (bots) => {
      const shown = memoryToolShown(bots);
      return ({ target }: McpServer.MiddlewareOptions) => shown(target);
    }),
    { global: true },
  ),
  Layer.effectDiscard(
    Effect.flatMap(BotService, (bots) => registerToolSearchFilter(memoryToolShown(bots))),
  ),
  // A switch applies on the bot's next turn: open sessions list their tools again.
  Layer.effectDiscard(
    Effect.gen(function* () {
      const bots = yield* BotService;
      const server = yield* McpServer.McpServer;
      yield* bots.memoryModeChanges.pipe(
        Stream.runForEach(() =>
          server.notifications["notifications/tools/list_changed"]({}).pipe(Effect.ignore),
        ),
        Effect.forkScoped,
      );
    }),
  ),
);

export const BotMcpToolsLive = Layer.merge(
  resultToolkitRegistration(BotToolkit, handlers),
  MemoryToolVisibility,
);
