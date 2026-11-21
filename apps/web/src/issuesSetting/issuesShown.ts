import type { ClientSettings } from "@t3tools/contracts";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { isProductFeatureShown } from "../product/productFlags";

const selectIssuesEnabled = (settings: ClientSettings) => settings.issuesEnabled;

/** Whether this build offers the "Issues" switch: only where the `issues` flag leaves it opt-in. */
export function isIssuesSettingShown(): boolean {
  return !isProductFeatureShown("issues");
}

/** Whether Issues shows: always with the `issues` flag, otherwise once the user turns it on. */
export function areIssuesShown(settings: ClientSettings = getClientSettings()): boolean {
  return !isIssuesSettingShown() || selectIssuesEnabled(settings);
}

export function useIssuesShown(): boolean {
  const enabled = useClientSettings(selectIssuesEnabled);
  return !isIssuesSettingShown() || enabled;
}
