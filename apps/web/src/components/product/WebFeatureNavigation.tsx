import { useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  listExperimentalWebNavigation,
  useWebProductComposition,
} from "../../product/WebComposition";
import type {
  ExperimentalWebFeatureContribution,
  ExperimentalWebNavigationContribution,
  ExperimentalWebNavigationSlot,
} from "../../product/WebFeature";
import { useConnectedWebFeatureAvailability } from "../../product/environmentProduct";
import { cn } from "../../lib/utils";
import {
  SIDEBAR_LABEL_COLOR_CLASS,
  SIDEBAR_LABEL_TEXT_CLASS,
  SIDEBAR_MUTED_TEXT_CLASS,
} from "../sidebar/sidebarTextStyles";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";

function WebFeatureNavigationItem({
  feature,
  item,
}: {
  readonly feature: ExperimentalWebFeatureContribution;
  readonly item: ExperimentalWebNavigationContribution;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const availability = useConnectedWebFeatureAvailability(feature, item.capabilities);
  const Icon = item.icon;
  const Accessory = item.accessory;

  const handleClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: item.path as never });
  }, [isMobile, item.path, navigate, setOpenMobile]);

  if (!availability.canLoad) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={pathname === item.path || pathname.startsWith(`${item.path}/`)}
        className={cn(
          "h-8 w-full justify-start gap-2 px-2 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86",
          SIDEBAR_MUTED_TEXT_CLASS,
        )}
        data-testid={`sidebar-${item.id}-tab`}
        onClick={handleClick}
      >
        {Icon ? <Icon className="size-4 shrink-0" /> : null}
        <span
          className={cn(
            "flex-1 truncate text-left",
            SIDEBAR_LABEL_COLOR_CLASS,
            SIDEBAR_LABEL_TEXT_CLASS,
          )}
        >
          {item.label}
        </span>
        {Accessory ? (
          <span
            className={cn(
              "ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums",
              SIDEBAR_MUTED_TEXT_CLASS,
              SIDEBAR_LABEL_TEXT_CLASS,
            )}
          >
            <Accessory />
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Extension-owned entries for the app's primary sidebar menu. */
function useWebFeatureNavigationEntries(slot: ExperimentalWebNavigationSlot) {
  const composition = useWebProductComposition();
  return listExperimentalWebNavigation(composition, slot);
}

export function WebFeatureNavigationItems({
  slot,
}: {
  readonly slot: ExperimentalWebNavigationSlot;
}) {
  const entries = useWebFeatureNavigationEntries(slot);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(({ feature, item }) => (
        <WebFeatureNavigationItem key={item.id} feature={feature} item={item} />
      ))}
    </>
  );
}

export function WebFeatureNavigationMenu({
  slot,
}: {
  readonly slot: ExperimentalWebNavigationSlot;
}) {
  const entries = useWebFeatureNavigationEntries(slot);
  if (entries.length === 0) return null;

  return (
    <SidebarGroup className="px-2 pt-1 pb-0">
      <SidebarMenu>
        {entries.map(({ feature, item }) => (
          <WebFeatureNavigationItem key={item.id} feature={feature} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
