import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import { SettingResetButton, SettingsRow } from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Switch } from "../components/ui/switch";
import { updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { isIssuesSettingShown } from "./issuesShown";

/** Settings, General, Sidebar: "Issues" turns on upstream's Issues page and its entry points. */
export function IssuesSettingsRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const enabled = useClientSettings((settings) => settings.issuesEnabled);
  if (!isIssuesSettingShown()) return null;
  const setEnabled = (value: boolean) => void updateClientSettings({ issuesEnabled: value });
  return (
    <SettingsRow
      {...searchableSetting("issues-page")}
      description={
        <T>
          Browse your repositories' issues from a page in the sidebar, and open issue links beside
          the thread.
        </T>
      }
      resetAction={
        enabled !== DEFAULT_CLIENT_SETTINGS.issuesEnabled ? (
          <SettingResetButton
            ariaLabel={gt("Reset Issues to default")}
            onClick={() => setEnabled(DEFAULT_CLIENT_SETTINGS.issuesEnabled)}
          />
        ) : null
      }
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          aria-label={gt("Issues")}
        />
      }
    />
  );
}
