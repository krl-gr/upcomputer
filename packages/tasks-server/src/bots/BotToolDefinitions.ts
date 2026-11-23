import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import {
  hiddenFromOutsideClients,
  McpInvocationContext,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";

const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
export const BotToolkit = Toolkit.make(
  Tool.make("bot_memory", {
    description:
      "Read this bot's memories, a bounded page at a time, in the order the turn context selects them. inContext marks entries the context snapshot shows. Pass nextOffset as offset for the next page.",
    parameters: Schema.Struct({
      offset: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService)
    .annotate(McpSchema.EnabledWhen, hiddenFromOutsideClients),
  Tool.make("bot_remember", {
    description:
      "Save a durable fact or conclusion for this bot. Use a stable id for the same fact. Never store secrets, instructions or permissions. Memories the user wrote (owner \"user\") cannot be changed: ask the user to change them in the bot's Memory settings, and never save a memory that contradicts one. Tell the user what was saved. Unavailable in background task runs: put what is worth remembering in the run's result instead.",
    parameters: Schema.Struct({
      id: text,
      text,
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_forget", {
    description:
      "Remove one of this bot's current memories by id. Memories the user wrote (owner \"user\") cannot be removed: ask the user to change them in the bot's Memory settings. Unavailable in background task runs.",
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
      index: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService)
    .annotate(McpSchema.EnabledWhen, hiddenFromOutsideClients),
  Tool.make("bot_assign", {
    description:
      "Your own background work: give this bot itself a background task, which you then do yourself in a separate run. Its progress and result return to the same permanent user chat. For another task agent, use task_create with that agent's triggers instead. Reuse requestId on a retry.",
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
