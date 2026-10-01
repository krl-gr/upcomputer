import { makeWsRpcProtocolClientForGroup } from "@upcomputer/client-runtime/ws-rpc-protocol";
import { ComputerUseRpcGroup } from "@upcomputer/computer-use-contracts/rpc";
import {
  COMPUTER_USE_WEB_ENVIRONMENT_API_FACTORY,
  COMPUTER_USE_WEB_FEATURE,
} from "@upcomputer/computer-use-web/feature";
import {
  TASKS_WEB_ENVIRONMENT_API_FACTORY,
  TASKS_WEB_FEATURE,
} from "@upcomputer/tasks-web/feature";
import { TasksWsRpcGroup } from "@upcomputer/tasks-web/rpc";

import {
  createExperimentalWebProductComposition,
  defineExperimentalWebRpcComposition,
} from "./WebComposition";

const makePublicWsRpcProtocolClient = makeWsRpcProtocolClientForGroup(
  TasksWsRpcGroup.merge(ComputerUseRpcGroup),
);

/**
 * Default product entry used by the public build: core plus task
 * orchestration, browser, and computer use.
 */
export const WEB_PRODUCT_COMPOSITION = createExperimentalWebProductComposition({
  features: [TASKS_WEB_FEATURE, COMPUTER_USE_WEB_FEATURE],
  rpc: defineExperimentalWebRpcComposition({
    clientFactory: () => makePublicWsRpcProtocolClient,
    extensionApis: [TASKS_WEB_ENVIRONMENT_API_FACTORY, COMPUTER_USE_WEB_ENVIRONMENT_API_FACTORY],
  }),
});
