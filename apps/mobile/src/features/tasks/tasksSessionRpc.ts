import { RpcScopeAuthorization, WsRpcGroup } from "@t3tools/contracts";
import { TasksWebRpcGroup } from "@t3tools/tasks-client/rpc";
import * as RpcClient from "effect/rpc/RpcClient";

/**
 * The session client with Up.computer's Tasks methods, as web builds it from its product. The
 * Tasks group gets the scope middleware the server merges it with, so the client decodes an
 * authorization failure instead of a defect.
 */
export const makeTasksSessionRpcClient = RpcClient.make(
  WsRpcGroup.merge(TasksWebRpcGroup.middleware(RpcScopeAuthorization)),
);
