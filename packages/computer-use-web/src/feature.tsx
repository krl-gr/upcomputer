import { Globe2Icon, MonitorCogIcon } from "lucide-react";

import { defineExperimentalWebFeature } from "../../../apps/web/src/extensionApi.ts";

export {
  COMPUTER_USE_WEB_ENVIRONMENT_API,
  COMPUTER_USE_WEB_ENVIRONMENT_API_FACTORY,
} from "./environmentApi.ts";

/** Trusted build-time registration for the Browser Use and Computer Use settings. */
export const COMPUTER_USE_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.computer-use.web",
  ownerId: "upcomputer.computer-use",
  extensionId: "upcomputer.computer-use",
  version: 1,
  settings: [
    {
      id: "browser-use",
      label: "Browser Use",
      path: "/settings/browser-use",
      order: 10,
      icon: Globe2Icon,
      load: () => import("./settings/BrowserUseSettingsPage.tsx"),
    },
    {
      id: "browser",
      label: "Browser Use",
      path: "/settings/browser",
      order: 10,
      icon: Globe2Icon,
      // Former path of the Browser Use page.
      hideFromNavigation: true,
      load: () => import("./settings/BrowserUseLegacyRedirect.tsx"),
    },
    {
      id: "computer-use",
      label: "Computer Use",
      path: "/settings/computer-use",
      order: 20,
      icon: MonitorCogIcon,
      load: () => import("./settings/ComputerUseSettingsPage.tsx"),
    },
  ],
});
