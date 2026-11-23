import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { useSidebar } from "../ui/sidebar";

/**
 * Every navigation closes the phone sidebar sheet, so a picked bot, thread or page shows at
 * once. onBeforeNavigate also fires for a tap on the entry already open, which loads the same
 * address again. A menu or popover that does not navigate leaves the sheet open.
 */
export function useCloseMobileSidebarOnNavigate() {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to router navigations, outside React
  useEffect(
    () => router.subscribe("onBeforeNavigate", () => setOpenMobile(false)),
    [router, setOpenMobile],
  );
}
