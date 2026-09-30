import { SettingsIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { APP_VERSION } from "../../branding";
import { cn } from "../../lib/utils";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveSidebarChromeHeaderLayout } from "./sidebarChromeLayout";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { SIDEBAR_LABEL_TEXT_CLASS, SIDEBAR_MUTED_TEXT_CLASS } from "./sidebarTextStyles";

/**
 * Shared chrome for every sidebar view mode.
 *
 * Upstream's own version of this file renders their stage badge, brand
 * wordmark, update pills and the per-channel header artwork from
 * `SidebarStageBackdrop`. This fork keeps its own header and footer under
 * the same two names.
 */

function UpComputerAppIcon() {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-[4px] object-contain"
      src="/favicon-32x32.png"
    />
  );
}

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const layout = resolveSidebarChromeHeaderLayout({ isElectron, platform });
  const headerContent = (
    <div className="flex items-center gap-2">
      {layout.hideBrand ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                aria-label="Go to threads"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
                to="/"
              >
                <UpComputerAppIcon />
              </Link>
            }
          />
          <TooltipPopup side="bottom" sideOffset={2}>
            Version {APP_VERSION}
          </TooltipPopup>
        </Tooltip>
      )}
      {/* Same top-right spot as the toggle in the chat tab bar, so one thumb
          position opens and closes the mobile sidebar. */}
      <SidebarTrigger className="ms-auto -me-2 shrink-0 sm:hidden" />
    </div>
  );

  return <SidebarHeader className={layout.className}>{headerContent}</SidebarHeader>;
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className={cn(
              "h-8 w-full justify-start gap-2 px-2 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset dark:hover:text-white/86",
              SIDEBAR_MUTED_TEXT_CLASS,
            )}
            onClick={handleSettingsClick}
          >
            <SettingsIcon className="size-4" />
            <span className={cn("text-foreground/72 dark:text-white/82", SIDEBAR_LABEL_TEXT_CLASS)}>
              Settings
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
