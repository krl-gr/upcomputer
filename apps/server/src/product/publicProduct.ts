import { COMPUTER_USE_SERVER_FEATURE } from "@t3tools/computer-use-server/feature";
import { TASKS_SERVER_FEATURE } from "@t3tools/tasks-server/feature";

import { LINKED_PROJECTS_SERVER_FEATURE } from "../linkedProjects/serverFeature.ts";

import { composeExperimentalServerFeatures } from "./ServerProduct.ts";

/**
 * The public server: core plus the open-source UpComputer features. Import it
 * only from entry points such as `bin.ts`; feature packages import the
 * extension API, so a module they reach must not import this one.
 */
export const PUBLIC_SERVER_PRODUCT = composeExperimentalServerFeatures([
  COMPUTER_USE_SERVER_FEATURE,
  LINKED_PROJECTS_SERVER_FEATURE,
  TASKS_SERVER_FEATURE,
]);
