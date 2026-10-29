import type { ClientSettings, SidebarThreadList } from "@t3tools/contracts";
import type { ProductSurfaceVariant } from "@t3tools/shared/productFlags";

import { useSidebarCompact } from "../adaptiveSidebar/adaptiveSidebar";
import { useClientSettings } from "../hooks/useSettings";
import { productSurface } from "../product/productFlags";

const selectThreadList = (settings: ClientSettings) => settings.sidebarThreadList;

/** The surface variant a "Thread list" choice stands for. */
function threadListSurface(threadList: SidebarThreadList): ProductSurfaceVariant {
  return threadList === "compact" ? "upcomputer" : "upstream";
}

/** Whether this build offers the "Thread list" setting (surface `sidebarThreadRow`). */
export function isThreadListSettingShown(): boolean {
  return productSurface("sidebarThreadRow") === "upcomputer";
}

/**
 * Which thread row the sidebar draws right now. A build with the upstream
 * surface always draws upstream's; otherwise the user's "Thread list" client
 * setting picks, and a change re-renders the list at once. The compact
 * sidebar always draws the compact row, which it knows how to show as an icon.
 */
export function useSidebarThreadRowSurface(): ProductSurfaceVariant {
  const threadList = useClientSettings(selectThreadList);
  const compact = useSidebarCompact();
  if (!isThreadListSettingShown()) return "upstream";
  return compact ? "upcomputer" : threadListSurface(threadList);
}
