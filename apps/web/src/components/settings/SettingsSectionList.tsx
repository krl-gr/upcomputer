import { useNavigate } from "@tanstack/react-router";

import { SettingsNavigationMenu, useSettingsNavigationEntries } from "./SettingsSidebarNav";
import { SETTINGS_SECTION_LIST_PATH } from "./settingsNavigation";

/**
 * The phone entry point to settings: the settings sidebar's section rows,
 * full width. Each section replaces the list in place.
 */
export function SettingsSectionList() {
  const navigate = useNavigate();
  const entries = useSettingsNavigationEntries();

  return (
    <nav
      aria-label="Settings sections"
      className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-safe"
    >
      <SettingsNavigationMenu
        entries={entries}
        pathname={SETTINGS_SECTION_LIST_PATH}
        onSelect={(to) => void navigate({ to: to as never, replace: true })}
      />
    </nav>
  );
}
