import { COMPUTER_USE_SERVER_FEATURE } from "@t3tools/computer-use-server/feature";
import { TASKS_SERVER_FEATURE } from "@t3tools/tasks-server/feature";
import { UPCOMPUTER_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";

import { LINKED_PROJECTS_SERVER_FEATURE } from "../linkedProjects/serverFeature.ts";

import { composeExperimentalServerFeatures } from "./ServerProduct.ts";

/**
 * The public server: core plus the open-source UpComputer features, with the
 * upstream features UpComputer does not ship hidden. Import it
 * only from entry points such as `bin.ts`; feature packages import the
 * extension API, so a module they reach must not import this one.
 */
export const PUBLIC_SERVER_PRODUCT = composeExperimentalServerFeatures(
  [COMPUTER_USE_SERVER_FEATURE, LINKED_PROJECTS_SERVER_FEATURE, TASKS_SERVER_FEATURE],
  { flags: UPCOMPUTER_PRODUCT_FLAGS },
);
