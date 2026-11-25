import {
  TaskAgentsRpcGroup,
  BotsRpcGroup,
  TaskAutomationsRpcGroup,
  TasksRpcGroup,
} from "@t3tools/tasks-contracts/v1";
import type * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcGroup from "effect/rpc/RpcGroup";

/** The Tasks namespaces the server's tasks feature adds to the WebSocket transport. */
export const TasksWebRpcGroup = TasksRpcGroup.merge(TaskAgentsRpcGroup)
  .merge(TaskAutomationsRpcGroup)
  .merge(BotsRpcGroup);

/** The session client as the Tasks UI sees it: only the Tasks methods. */
export type TasksWsRpcProtocolClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof TasksWebRpcGroup>>;
