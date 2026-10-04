import {
  TaskAgentsRpcGroup,
  TaskAutomationsRpcGroup,
  TasksRpcGroup,
} from "@t3tools/tasks-contracts/v1";

import type { ExperimentalFeatureRpcClient } from "../../../../apps/web/src/extensionApi.ts";

/** The Tasks namespaces the server's tasks feature adds to the WebSocket transport. */
export const TasksWebRpcGroup =
  TasksRpcGroup.merge(TaskAgentsRpcGroup).merge(TaskAutomationsRpcGroup);

/** The session client as the Tasks UI sees it: only the Tasks methods. */
export type TasksWsRpcProtocolClient = ExperimentalFeatureRpcClient<typeof TasksWebRpcGroup>;
