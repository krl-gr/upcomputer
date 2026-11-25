import { UserSurveyRpcGroup } from "@t3tools/contracts";

// The pure host module: the product entry imports this file while the
// connection runtime is still initializing.
import { defineExperimentalWebFeature } from "../product/WebFeature";

/** The in-app survey's RPCs; the sidebar card that asks it is part of core. */
export const USER_SURVEYS_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.user-surveys.web",
  version: 1,
  rpcGroups: [UserSurveyRpcGroup],
});
