import type { NavigationTab } from "./navigation-tab-order";

/**
 * Up.computer's bottom bar: Chats, Tasks, Limits and Notifications, then More in the fifth
 * slot (upstream's Settings slot), which lists Workers, Pull requests, Issues and Settings.
 */
export const MORE_TAB = "more" satisfies NavigationTab;

/** Notifications and More are single pages, like Usage, with no detail column beside them. */
export function isMorePageTab(tab: string): tab is "notifications" | "more" {
  return tab === "notifications" || tab === MORE_TAB;
}

/** Sections More opens in its own slot, which show Back to More. */
export function openedFromMore(tab: NavigationTab, settingsOpen: boolean) {
  return settingsOpen || tab === "pullRequests" || tab === "issues";
}

/**
 * The bar's icons: iconmcp template images in the native module's T3NativeControlIcons bundle
 * (`modules/t3-native-controls/ios/Resources/Icons`). The settings slot is More.
 */
export const BOTTOM_BAR_ICONS: Readonly<Record<string, string>> = {
  threads: "chats",
  tasks: "tasks",
  usage: "limits",
  notifications: "notifications",
  settings: "more",
};

/** Tabs the bar leaves out that More lists, so the Settings list doesn't list them again. */
export function listedInMore(tab: NavigationTab) {
  return tab === MORE_TAB || openedFromMore(tab, false);
}
