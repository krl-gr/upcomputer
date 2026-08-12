import { useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  listExperimentalWebSettings,
  useWebProductComposition,
} from "../../product/WebComposition";
import type { ExperimentalWebSettingsPageContribution } from "../../product/WebFeature";
import { SIDEBAR_LABEL_TEXT_CLASS, SIDEBAR_MUTED_TEXT_CLASS } from "../sidebar/sidebarTextStyles";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

function SettingsNavigationItem({
  page,
}: {
  readonly page: ExperimentalWebSettingsPageContribution;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const Icon = page.icon;
  const handleClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: page.path as never, replace: true });
  }, [isMobile, navigate, page.path, setOpenMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={pathname === page.path}
        className={
          pathname === page.path
            ? "h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86 dark:data-[active=true]:text-white/82"
            : `h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground dark:hover:text-white/86 ${SIDEBAR_MUTED_TEXT_CLASS}`
        }
        onClick={handleClick}
      >
        {Icon ? <Icon className="size-4 shrink-0" /> : null}
        <span
          className={SIDEBAR_LABEL_TEXT_CLASS + " truncate text-foreground/72 dark:text-white/82"}
        >
          {page.label}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function WebFeatureSettingsNavigationItems() {
  const composition = useWebProductComposition();
  const pages = listExperimentalWebSettings(composition);
  return pages.map(({ feature, page }) => (
    <SettingsNavigationItem key={`${feature.id}:${page.id}`} page={page} />
  ));
}
