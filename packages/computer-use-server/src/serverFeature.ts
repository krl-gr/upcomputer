import { COMPUTER_USE_RPC_CAPABILITY } from "@upcomputer/computer-use-contracts/rpc";
import type { ExperimentalProductExtensionRegistration } from "@upcomputer/shared/product";
import * as Effect from "effect/Effect";

import {
  defineExperimentalMcpTools,
  defineExperimentalPreviewAutomationHost,
  defineExperimentalServerFeature,
} from "../../../apps/server/src/extensionApi.ts";
import { makeChromePreviewAutomationHost } from "./browser/ChromePreviewHost.ts";
import { makeComputerUseService } from "./computerUse/ComputerUseService.ts";
import { makeComputerUseMcpTools } from "./mcp/ComputerUseMcpTools.ts";
import { COMPUTER_USE_RPC_CONTRIBUTION } from "./rpc/ComputerUseRpc.ts";

export const COMPUTER_USE_FEATURE_ID = "upcomputer.computer-use" as const;

/** Runs every harness's preview_* browser tools in the managed Chrome when no desktop app serves them. */
export const CHROME_PREVIEW_AUTOMATION_HOST = defineExperimentalPreviewAutomationHost({
  id: "chrome",
  ownerId: COMPUTER_USE_FEATURE_ID,
  version: 1,
  make: makeChromePreviewAutomationHost,
});

/** The computer_* tools on the core MCP server, for every harness. */
export const COMPUTER_USE_MCP_TOOLS = defineExperimentalMcpTools({
  id: "computer-use-tools",
  ownerId: COMPUTER_USE_FEATURE_ID,
  version: 1,
  make: Effect.map(makeComputerUseService, makeComputerUseMcpTools),
});

export const COMPUTER_USE_SERVER_FEATURE = defineExperimentalServerFeature({
  id: COMPUTER_USE_FEATURE_ID,
  version: 1,
  rpc: [COMPUTER_USE_RPC_CONTRIBUTION],
  previewAutomationHosts: [CHROME_PREVIEW_AUTOMATION_HOST],
  mcpTools: [COMPUTER_USE_MCP_TOOLS],
});

/** Product-manifest entry advertising the browser and computer-use settings RPC. */
export const COMPUTER_USE_PRODUCT_EXTENSION = {
  id: COMPUTER_USE_FEATURE_ID,
  displayName: "Browser and Computer Use",
  description:
    "A managed Chrome for the preview browser tools and native desktop observation and control for every agent.",
  version: "1.0.0",
  source: "core",
  availability: "free",
  enabled: true,
  capabilities: [COMPUTER_USE_RPC_CAPABILITY],
} as const satisfies ExperimentalProductExtensionRegistration;
