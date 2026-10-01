import { ORCHESTRATOR_WEB_FEATURE } from "@upcomputer/orchestrator-web/feature";
import {
  TASKS_WEB_ENVIRONMENT_API_FACTORY,
  TASKS_WEB_FEATURE,
} from "@upcomputer/tasks-web/feature";
import { makeTasksWsRpcProtocolClient } from "@upcomputer/tasks-web/rpc";

import {
  createExperimentalWebProductComposition,
  defineExperimentalWebRpcComposition,
} from "./WebComposition";

/** Default product entry used by the public build: core plus task orchestration. */
export const WEB_PRODUCT_COMPOSITION = createExperimentalWebProductComposition({
  features: [TASKS_WEB_FEATURE, ORCHESTRATOR_WEB_FEATURE],
  rpc: defineExperimentalWebRpcComposition({
    clientFactory: () => makeTasksWsRpcProtocolClient,
    extensionApis: [TASKS_WEB_ENVIRONMENT_API_FACTORY],
  }),
});
