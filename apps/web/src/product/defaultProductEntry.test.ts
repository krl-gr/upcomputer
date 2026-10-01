import { describe, expect, it } from "vite-plus/test";

import { WEB_PRODUCT_COMPOSITION } from "./defaultProductEntry";
import { listExperimentalWebRoutes, listExperimentalWebSettings } from "./WebComposition";

describe("default web product entry", () => {
  it("composes the Tasks and Orchestrator web features with the tasks RPC client", () => {
    expect(WEB_PRODUCT_COMPOSITION.features.map((feature) => feature.id)).toEqual([
      "upcomputer.orchestrator.web",
      "upcomputer.tasks.web",
    ]);
    expect(
      listExperimentalWebRoutes(WEB_PRODUCT_COMPOSITION).map(({ route }) => route.path),
    ).toEqual(["/agents", "/automations", "/tasks"]);
    expect(
      listExperimentalWebSettings(WEB_PRODUCT_COMPOSITION).map(({ page }) => page.path),
    ).toEqual(["/settings/instructions"]);
    expect(WEB_PRODUCT_COMPOSITION.rpc?.extensionApis.map((api) => api.id)).toEqual([
      "upcomputer.tasks.web-rpc",
    ]);
  });
});
