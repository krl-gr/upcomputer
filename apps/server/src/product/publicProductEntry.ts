import {
  ORCHESTRATOR_PRODUCT_EXTENSION,
  ORCHESTRATOR_SERVER_FEATURE,
} from "@upcomputer/orchestrator";
import { createUpcomputerProductManifest } from "@upcomputer/shared/product";
import { TASKS_PRODUCT_EXTENSION, TASKS_SERVER_FEATURE } from "@upcomputer/tasks-server/feature";

import packageJson from "../../package.json" with { type: "json" };
import { composeExperimentalServerFeatures } from "./ServerProductComposition.ts";
import { defineExperimentalServerProductEntry } from "./ServerProductEntry.ts";

/**
 * Product entry for the public server CLI: core plus the open-source task
 * orchestration features. Import it only from entrypoints such as `bin.ts`:
 * the feature packages import the extension API, which re-exports
 * `server.ts`, so a module reachable from there must not import this one.
 */
export const PUBLIC_SERVER_PRODUCT_ENTRY = defineExperimentalServerProductEntry({
  manifest: createUpcomputerProductManifest(packageJson.version, [
    ORCHESTRATOR_PRODUCT_EXTENSION,
    TASKS_PRODUCT_EXTENSION,
  ]),
  composition: composeExperimentalServerFeatures([
    ORCHESTRATOR_SERVER_FEATURE,
    TASKS_SERVER_FEATURE,
  ]),
});
