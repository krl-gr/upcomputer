import * as Layer from "effect/Layer";

import {
  defineExperimentalServerFeature,
  eraseExperimentalServerLayer,
} from "../../../apps/server/src/extensionApi.ts";
import { BrowserAutomationServiceLive } from "./browser/BrowserAutomationService.ts";
import { ChromePreviewHostLive } from "./browser/ChromePreviewHost.ts";
import { ComputerUseServiceLive } from "./computerUse/ComputerUseService.ts";
import { ComputerUseMcpToolsLive } from "./mcp/ComputerUseMcpTools.ts";
import { COMPUTER_USE_RPC_CONTRIBUTION } from "./rpc/ComputerUseRpc.ts";

const COMPUTER_USE_FEATURE_ID = "upcomputer.computer-use";

/**
 * Desktop computer use and the managed Chrome for every provider: the
 * computer_* tools on the core MCP server, Chrome as a second host for the
 * preview_* tools, and the settings RPC.
 */
export const COMPUTER_USE_SERVER_FEATURE = defineExperimentalServerFeature({
  id: COMPUTER_USE_FEATURE_ID,
  version: 1,
  layers: [
    {
      id: "computer-use-services",
      ownerId: COMPUTER_USE_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(
        Layer.mergeAll(ComputerUseServiceLive, BrowserAutomationServiceLive),
      ),
    },
  ],
  mcpTools: [
    {
      id: "computer-use-tools",
      ownerId: COMPUTER_USE_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(ComputerUseMcpToolsLive),
    },
    {
      // Built with the MCP server, so it joins the broker the preview_* tools use.
      id: "chrome-preview-host",
      ownerId: COMPUTER_USE_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(ChromePreviewHostLive),
    },
  ],
  rpc: [COMPUTER_USE_RPC_CONTRIBUTION],
});
