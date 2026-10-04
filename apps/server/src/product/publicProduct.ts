import { TASKS_SERVER_FEATURE } from "@t3tools/tasks-server/feature";

import { composeExperimentalServerFeatures } from "./ServerProduct.ts";

/**
 * The public server: core plus the open-source UpComputer features. Import it
 * only from entry points such as `bin.ts`; feature packages import the
 * extension API, so a module they reach must not import this one.
 */
export const PUBLIC_SERVER_PRODUCT = composeExperimentalServerFeatures([TASKS_SERVER_FEATURE]);
