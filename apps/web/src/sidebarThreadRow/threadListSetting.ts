import type { ClientSettings, SidebarThreadList } from "@t3tools/contracts";
import type { ProductSurfaceVariant } from "@t3tools/shared/productFlags";

import { useClientSettings } from "../hooks/useSettings";
import { productSurface } from "../product/productFlags";

const selectThreadList = (settings: ClientSettings) => settings.sidebarThreadList;

/** The surface variant a "Thread list" choice stands for. */
export function threadListSurface(threadList: SidebarThreadList): ProductSurfaceVariant {
  return threadList === "compact" ? "upcomputer" : "upstream";
}

/** Whether this build offers the "Thread list" setting (surface `sidebarThreadRow`). */
export function isThreadListSettingShown(): boolean {
  return productSurface("sidebarThreadRow") === "upcomputer";
}

/**
 * Which thread row the sidebar draws right now. A build with the upstream
 * surface always draws upstream's; otherwise the user's "Thread list" client
 * setting picks, and a change re-renders the list at once.
 */
export function useSidebarThreadRowSurface(): ProductSurfaceVariant {
  const threadList = useClientSettings(selectThreadList);
  return isThreadListSettingShown() ? threadListSurface(threadList) : "upstream";
}
