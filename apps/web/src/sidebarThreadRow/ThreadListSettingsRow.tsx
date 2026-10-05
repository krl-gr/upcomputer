import { DEFAULT_CLIENT_SETTINGS, type SidebarThreadList } from "@t3tools/contracts";

import { SettingResetButton, SettingsRow } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { isThreadListSettingShown } from "./threadListSetting";

const THREAD_LIST_LABELS: Record<SidebarThreadList, string> = {
  compact: "Compact",
  detailed: "Detailed",
};

/**
 * Settings, Appearance: "Thread list" picks the sidebar's thread rows. It is
 * a client setting, like Chat width, and the sidebar follows it at once.
 */
export function ThreadListSettingsRow() {
  const threadList = useClientSettings((settings) => settings.sidebarThreadList);
  const updateClientSettings = useUpdateClientSettings();
  if (!isThreadListSettingShown()) return null;
  const setThreadList = (value: SidebarThreadList) =>
    void updateClientSettings({ sidebarThreadList: value });
  return (
    <SettingsRow
      {...searchableSetting("thread-list")}
      description="Show threads in the sidebar as compact one-line rows, or as detailed cards."
      resetAction={
        threadList !== DEFAULT_CLIENT_SETTINGS.sidebarThreadList ? (
          <SettingResetButton
            label="thread list"
            onClick={() => setThreadList(DEFAULT_CLIENT_SETTINGS.sidebarThreadList)}
          />
        ) : null
      }
      control={
        <div className="w-full sm:w-40">
          <Select
            value={threadList}
            onValueChange={(value) => {
              if (value === "compact" || value === "detailed") setThreadList(value);
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Thread list">
              <SelectValue>{THREAD_LIST_LABELS[threadList]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="compact">Compact (default)</SelectItem>
              <SelectItem value="detailed">Detailed</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
