import { ComputerUseRpcGroup } from "@t3tools/computer-use-contracts/rpc";
import { Globe2Icon, MonitorCogIcon } from "lucide-react";
import { msg } from "gt-react";

// The pure host module: the product entry imports this file while the
// connection runtime is still initializing. The pages load on first visit.
import { defineExperimentalWebFeature } from "../../../apps/web/src/product/WebFeature.ts";

/** The Browser Use and Computer Use settings sections. */
export const COMPUTER_USE_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.computer-use.web",
  version: 1,
  rpcGroups: [ComputerUseRpcGroup],
  settings: [
    {
      id: "browser-use",
      label: msg("Browser Use"),
      path: "/settings/browser-use",
      order: 10,
      icon: Globe2Icon,
      load: () => import("./settings/BrowserUseSettingsPage.tsx"),
    },
    {
      id: "computer-use",
      label: msg("Computer Use"),
      path: "/settings/computer-use",
      order: 20,
      icon: MonitorCogIcon,
      load: () => import("./settings/ComputerUseSettingsPage.tsx"),
    },
  ],
});
