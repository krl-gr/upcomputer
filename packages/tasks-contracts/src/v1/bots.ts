import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { TaskAgent, TaskAgentConfig, TaskAgentId } from "./agents.ts";
import { TaskError, TaskResponse } from "./tasks.ts";

export const Bot = Schema.Struct({
  agent: TaskAgent,
  threadId: ThreadId,
  projectId: ProjectId,
  allowedProjectIds: Schema.Array(ProjectId),
  latestTaskRun: Schema.optional(Schema.Struct({ threadId: ThreadId, status: Schema.String })),
});
export type Bot = typeof Bot.Type;

export const BotWriteInput = Schema.Struct({
  id: TaskAgentId,
  threadId: Schema.optional(ThreadId),
  projectId: ProjectId,
  allowedProjectIds: Schema.Array(ProjectId),
  name: TrimmedNonEmptyString,
  config: TaskAgentConfig,
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
  assign: `${BOTS_RPC_NAMESPACE}.assign`,
  extract: `${BOTS_RPC_NAMESPACE}.extract`,
} as const;
const agentInput = Schema.Struct({ agentId: TaskAgentId });
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
  Rpc.make(BOTS_RPC_METHODS.forget, {
    payload: Schema.Struct({ ...agentInput.fields, id: TrimmedNonEmptyString }),
    error: TaskError,
  }),
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
