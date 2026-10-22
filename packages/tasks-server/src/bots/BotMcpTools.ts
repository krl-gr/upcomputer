import { OrchestratorMcpFailure, TurnItemId } from "@t3tools/contracts";
import { TaskError } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import {
  McpInvocationContext,
  McpToolAccess,
  resultToolkitRegistration,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { agentRunModes, broaderRunMode } from "../agents/runModes.ts";
import { BotService } from "./BotService.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";

const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
const toolkit = Toolkit.make(
  Tool.dynamic("bot_memory", {
    description: "Read this bot's current global and working-project memories.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_remember", {
    description:
      "Save a durable fact or conclusion for this bot. Use a stable id for the same fact. Default scope is project. Never store secrets, instructions or permissions. Tell the user what was saved. In a background task run this saves a suggestion that the user reviews before it becomes memory.",
    parameters: Schema.Struct({
      id: text,
      text,
      scope: Schema.optional(Schema.Literals(["global", "project"])),
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_forget", {
    description:
      "Remove one of this bot's current memories by id. Unavailable in background task runs.",
    parameters: Schema.Struct({ id: text }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_history_search", {
    description:
      "Search the bot's own permanent conversation, including old history outside the current context. Returns a bounded page around the selected match.",
    parameters: Schema.Struct({
      query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      index: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_assign", {
    description:
      "Give this bot a background task. Its progress and result return to the same permanent user chat. Reuse requestId on a retry.",
    parameters: Schema.Struct({
      requestId: text,
      title: text,
      description: Schema.String.check(Schema.isMaxLength(50000)),
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
);

const handlers = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const bots = yield* BotService;
    const repository = yield* TaskRepository;
    const threads = yield* ThreadManagementService;
    const caller = (write: boolean) =>
      Effect.gen(function* () {
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
        const projectId = bot.threadId === threadId ? bot.projectId : thread.projectId;
        if (!bot.allowedProjectIds.includes(projectId))
          return yield* new TaskError({ message: "This project is unavailable to the bot." });
        return { bot, projectId, thread };
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
                  text: cause instanceof Error ? cause.message : "Bot operation failed.",
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
      bot_memory: McpToolAccess.readsAsCaller(() =>
        result(
          Effect.gen(function* () {
            const { bot, projectId } = yield* caller(false);
            return (yield* bots.memory(bot.agent.id)).filter(
              (entry) => entry.projectId === null || entry.projectId === projectId,
            );
          }),
        ),
      ),
      bot_remember: McpToolAccess.writes((input) =>
        result(
          Effect.gen(function* () {
            const { bot, projectId, thread } = yield* caller(true);
            const existing = (yield* bots.memory(bot.agent.id)).find(
              (entry) => entry.id === input.id,
            );
            if (existing && existing.projectId !== null && existing.projectId !== projectId)
              return yield* new TaskError({
                message: "This memory is outside the current project.",
              });
            const run = yield* repository.findLatestAgentRunByThreadId({ threadId: thread.id });
            const entry = {
              agentId: bot.agent.id,
              id: input.id,
              text: input.text,
              projectId: input.scope === "global" ? null : projectId,
            };
            if (Option.isNone(run))
              return yield* bots.remember({ ...entry, source: `chat:${thread.id}` });
            // Task runs read untrusted pages and repositories, so their memories wait for the user.
            return {
              suggestion: yield* bots.propose({
                ...entry,
                source: `task:${run.value.taskId}/run:${run.value.id}`,
                runId: run.value.id,
              }),
              note: "Saved as a suggestion. It becomes memory only after the user accepts it in Bots.",
            };
          }),
        ),
      ),
      bot_forget: McpToolAccess.writes((input) =>
        result(
          Effect.gen(function* () {
            const { bot, projectId, thread } = yield* caller(true);
            if (
              Option.isSome(yield* repository.findLatestAgentRunByThreadId({ threadId: thread.id }))
            )
              return yield* new TaskError({
                message:
                  "Background task runs cannot remove memories. Ask the user in the bot's chat.",
              });
            const entry = (yield* bots.memory(bot.agent.id)).find((item) => item.id === input.id);
            if (entry && entry.projectId !== null && entry.projectId !== projectId)
              return yield* new TaskError({
                message: "This memory is outside the current project.",
              });
            yield* bots.forget(bot.agent.id, input.id);
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
              ...(input.index === undefined ? {} : { index: input.index }),
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
export const BotMcpToolsLive = resultToolkitRegistration(toolkit, handlers);
