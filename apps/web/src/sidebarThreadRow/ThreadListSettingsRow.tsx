import { DEFAULT_CLIENT_SETTINGS, type SidebarThreadList } from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";

import { SettingResetButton, SettingsRow } from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { isThreadListSettingShown } from "./threadListSetting";

const THREAD_LIST_LABELS: Record<SidebarThreadList, string> = {
  compact: msg("Compact"),
  detailed: msg("Detailed"),
};

/**
 * Settings, Appearance: "Thread list" picks the sidebar's thread rows. It is
 * a client setting, like Chat width, and the sidebar follows it at once.
 */
export function ThreadListSettingsRow() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const threadList = useClientSettings((settings) => settings.sidebarThreadList);
  if (!isThreadListSettingShown()) return null;
  const setThreadList = (value: SidebarThreadList) =>
    void updateClientSettings({ sidebarThreadList: value });
  const setting = searchableSetting("thread-list");
  return (
    <SettingsRow
      {...setting}
      description={
        <T>Show threads in the sidebar as compact one-line rows, or as detailed cards.</T>
      }
      resetAction={
        threadList !== DEFAULT_CLIENT_SETTINGS.sidebarThreadList ? (
          <SettingResetButton
            ariaLabel={gt("Reset thread list to default")}
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
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Thread list")}>
              <SelectValue>{m(THREAD_LIST_LABELS[threadList])}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="compact">
                <T>Compact (default)</T>
              </SelectItem>
              <SelectItem value="detailed">
                <T>Detailed</T>
              </SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
