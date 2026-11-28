import { useMessages } from "gt-react-native";

import { useNotificationCount } from "../../notifications/useNotifications";
import { BOTTOM_BAR_ICONS, MORE_TAB } from "./moreTab";
import type { NavigationTab } from "./navigation-tab-order";
import { WORKSPACE_TAB_LABELS } from "./navigation-tabs";

/** The bar's accessible names (it shows icons alone), its icons, and the Notifications badge. */
export function useBottomBarItems(tabs: ReadonlyArray<NavigationTab | "settings">) {
  const m = useMessages();
  const notifications = useNotificationCount();
  return {
    itemLabels: Object.fromEntries(
      tabs.map((tab) => [tab, m(WORKSPACE_TAB_LABELS[tab === "settings" ? MORE_TAB : tab])]),
    ),
    itemSymbols: BOTTOM_BAR_ICONS,
    badgedTabs: notifications > 0 ? ["notifications"] : [],
  };
}
