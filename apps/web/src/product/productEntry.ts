import { COMPUTER_USE_WEB_FEATURE } from "@t3tools/computer-use-web/feature";
import { TASKS_WEB_FEATURE } from "@t3tools/tasks-web/feature";
import {
  UPCOMPUTER_PRODUCT_FLAGS,
  UPCOMPUTER_PRODUCT_SURFACES,
} from "@t3tools/shared/productFlags";

import { LINKED_PROJECTS_WEB_FEATURE } from "../linkedProjects/feature";
import { composeExperimentalWebFeatures } from "./WebProduct";

/**
 * The web product this build ships: core plus its web features, with the
 * upstream features UpComputer does not ship hidden and its own versions of
 * the replaceable surfaces. Another product build replaces this module with
 * its own composition.
 */
export const WEB_PRODUCT = composeExperimentalWebFeatures(
  [COMPUTER_USE_WEB_FEATURE, LINKED_PROJECTS_WEB_FEATURE, TASKS_WEB_FEATURE],
  { flags: UPCOMPUTER_PRODUCT_FLAGS, surfaces: UPCOMPUTER_PRODUCT_SURFACES },
);
