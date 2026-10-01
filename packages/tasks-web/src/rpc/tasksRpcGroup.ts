import {
  TaskAgentsRpcGroup,
  TaskAutomationsRpcGroup,
  TasksRpcGroup,
} from "@upcomputer/tasks-contracts/v1";
import { makeWsRpcProtocolClientForGroup } from "@upcomputer/client-runtime/ws-rpc-protocol";
import { WsRpcGroup } from "@upcomputer/contracts";
import type * as Effect from "effect/Effect";

/** Core RPC shape plus the Tasks namespaces, served over the same socket. */
export const TasksWsRpcGroup = WsRpcGroup.merge(TasksRpcGroup)
  .merge(TaskAgentsRpcGroup)
  .merge(TaskAutomationsRpcGroup);

export const makeTasksWsRpcProtocolClient = makeWsRpcProtocolClientForGroup(TasksWsRpcGroup);

export type TasksWsRpcProtocolClient =
  typeof makeTasksWsRpcProtocolClient extends Effect.Effect<infer Client, any, any>
    ? Client
    : never;
