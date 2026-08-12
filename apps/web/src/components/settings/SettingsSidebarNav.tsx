import { useCallback, type ComponentType } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  Settings2Icon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { T3ConnectSidebarAvatar, T3ConnectSidebarSignIn } from "../clerk/T3ConnectSidebarSignIn";
import { SIDEBAR_LABEL_TEXT_CLASS, SIDEBAR_MUTED_TEXT_CLASS } from "../sidebar/sidebarTextStyles";
import { WebFeatureSettingsNavigationItems } from "../product/WebFeatureSettingsNavigation";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/beta"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { label: "Providers", to: "/settings/providers", icon: BotIcon },
  { label: "Source Control", to: "/settings/source-control", icon: GitBranchIcon },
  { label: "Connections", to: "/settings/connections", icon: Link2Icon },
  { label: "Beta", to: "/settings/beta", icon: FlaskConicalIcon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSectionClick = useCallback(
    (to: SettingsSectionPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, replace: true });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/", replace: true });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-2 pt-2 pb-2">
          <SidebarMenu className="gap-0.5">
            {SETTINGS_NAV_ITEMS.slice(0, 1).map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    className={
                      isActive
                        ? "h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86 dark:data-[active=true]:text-white/82"
                        : `h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground dark:hover:text-white/86 ${SIDEBAR_MUTED_TEXT_CLASS}`
                    }
                    onClick={() => handleSectionClick(item.to)}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span
                      className={
                        SIDEBAR_LABEL_TEXT_CLASS + " truncate text-foreground/72 dark:text-white/82"
                      }
                    >
                      {item.label}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            <WebFeatureSettingsNavigationItems />
            {SETTINGS_NAV_ITEMS.slice(1).map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    className={
                      isActive
                        ? "h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86 dark:data-[active=true]:text-white/82"
                        : `h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground dark:hover:text-white/86 ${SIDEBAR_MUTED_TEXT_CLASS}`
                    }
                    onClick={() => handleSectionClick(item.to)}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span
                      className={
                        SIDEBAR_LABEL_TEXT_CLASS + " truncate text-foreground/72 dark:text-white/82"
                      }
                    >
                      {item.label}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <T3ConnectSidebarSignIn />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
          <SidebarMenu className="min-w-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                className="h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                onClick={handleBackClick}
              >
                <ArrowLeftIcon className="size-4" />
                <span>Back</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <T3ConnectSidebarAvatar />
        </div>
      </SidebarFooter>
    </>
  );
}
