import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { TaskAgent, TaskAgentConfig, TaskAgentId } from "./agents.ts";
import { TaskError, TaskResponse } from "./tasks.ts";

const botColorIds = [
  "gray",
  "blue",
  "orange",
  "black",
  "green",
  "brown",
  "purple",
  "red",
  "teal",
  "yellow",
  "coral",
  "navy",
] as const;

export const BotAppearance = Schema.Struct({
  shape: Schema.Literals([
    "drop",
    "triangle",
    "cloud",
    "circle",
    "capsule",
    "peanut",
    "diamond",
    "bean",
    "dome",
    "squircle",
    "star",
    "blob",
  ]),
  color: Schema.Literals(botColorIds),
  accessory: Schema.Literals([
    "none",
    "bowtie",
    "gentleman",
    "detective",
    "chef",
    "builder",
    "artist",
    "graduate",
    "cowboy",
    "wizard",
    "professor",
    "headphones",
    "crown",
    "pirate",
    "firefighter",
    "police",
    "nurse",
    "scientist",
    "pilot",
    "santa",
    "winter",
    "summer",
    "photographer",
    "bunny",
  ]),
});
export type BotAppearance = typeof BotAppearance.Type;

/** The look of a bot that never chose one: a capsule in a color derived from its id. */
export const defaultBotAppearance = (id: string): BotAppearance => ({
  shape: "capsule",
  color:
    botColorIds[
      [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % botColorIds.length
    ]!,
  accessory: "none",
});

export const Bot = Schema.Struct({
  agent: TaskAgent,
  /** Missing or null draws `defaultBotAppearance` for older bots and servers. */
  appearance: Schema.optional(Schema.NullOr(BotAppearance)),
  threadId: ThreadId,
  projectId: ProjectId,
  allowedProjectIds: Schema.Array(ProjectId),
  latestTaskRun: Schema.optional(
    Schema.Struct({
      threadId: ThreadId,
      status: Schema.String,
      /** When the run ended; absent from older servers and while it runs. */
      completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
    }),
  ),
});
export type Bot = typeof Bot.Type;

export const BotWriteInput = Schema.Struct({
  id: TaskAgentId,
  threadId: Schema.optional(ThreadId),
  projectId: ProjectId,
  allowedProjectIds: Schema.Array(ProjectId),
  name: TrimmedNonEmptyString,
  config: TaskAgentConfig,
  /** Omitted preserves the saved style. Null clears it back to `defaultBotAppearance`. */
  appearance: Schema.optional(Schema.NullOr(BotAppearance)),
});
export type BotWriteInput = typeof BotWriteInput.Type;

export const BotMemory = Schema.Struct({
  id: TrimmedNonEmptyString,
  agentId: TaskAgentId,
  projectId: Schema.NullOr(ProjectId),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  source: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BotMemory = typeof BotMemory.Type;
/** Suggested by a background task run; accepting writes `targetId` as an ordinary memory. */
export const BotMemoryProposal = Schema.Struct({
  ...BotMemory.fields,
  targetId: TrimmedNonEmptyString,
});
export type BotMemoryProposal = typeof BotMemoryProposal.Type;
export const BotMemoryWriteInput = Schema.Struct({
  agentId: TaskAgentId,
  id: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  text: BotMemory.fields.text,
  source: BotMemory.fields.source,
});
export type BotMemoryWriteInput = typeof BotMemoryWriteInput.Type;

export const BOTS_RPC_NAMESPACE = "upcomputer.bots.v1";
export const BOTS_RPC_METHODS = {
  list: `${BOTS_RPC_NAMESPACE}.list`,
  save: `${BOTS_RPC_NAMESPACE}.save`,
  remove: `${BOTS_RPC_NAMESPACE}.remove`,
  memory: `${BOTS_RPC_NAMESPACE}.memory`,
  remember: `${BOTS_RPC_NAMESPACE}.remember`,
  forget: `${BOTS_RPC_NAMESPACE}.forget`,
  proposals: `${BOTS_RPC_NAMESPACE}.proposals`,
  acceptProposal: `${BOTS_RPC_NAMESPACE}.acceptProposal`,
  rejectProposal: `${BOTS_RPC_NAMESPACE}.rejectProposal`,
  assign: `${BOTS_RPC_NAMESPACE}.assign`,
  extract: `${BOTS_RPC_NAMESPACE}.extract`,
} as const;
const agentInput = Schema.Struct({ agentId: TaskAgentId });
const entryInput = Schema.Struct({ ...agentInput.fields, id: TrimmedNonEmptyString });
export const BotsRpcGroup = RpcGroup.make(
  Rpc.make(BOTS_RPC_METHODS.extract, {
    payload: Schema.Struct({ ...agentInput.fields, requestId: TrimmedNonEmptyString }),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.list, {
    payload: Schema.Struct({}),
    success: Schema.Array(Bot),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.save, { payload: BotWriteInput, success: Bot, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.remove, { payload: agentInput, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.memory, {
    payload: agentInput,
    success: Schema.Array(BotMemory),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.remember, {
    payload: BotMemoryWriteInput,
    success: BotMemory,
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.forget, { payload: entryInput, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.proposals, {
    payload: agentInput,
    success: Schema.Array(BotMemoryProposal),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.acceptProposal, {
    payload: entryInput,
    success: BotMemory,
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.rejectProposal, { payload: entryInput, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.assign, {
    payload: Schema.Struct({
      ...agentInput.fields,
      requestId: TrimmedNonEmptyString,
      title: TrimmedNonEmptyString,
      description: Schema.String,
    }),
    success: TaskResponse,
    error: TaskError,
  }),
);
