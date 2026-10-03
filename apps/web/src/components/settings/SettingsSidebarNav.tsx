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
import {
  UpcomputerConnectSidebarAvatar,
  UpcomputerConnectSidebarSignIn,
} from "../clerk/UpcomputerConnectSidebarSignIn";
import { SIDEBAR_LABEL_TEXT_CLASS, SIDEBAR_MUTED_TEXT_CLASS } from "../sidebar/sidebarTextStyles";
import {
  listExperimentalWebSettings,
  useWebProductComposition,
} from "../../product/WebComposition";
import {
  resolveSettingsNavigationEntries,
  type SettingsNavigationEntry,
} from "./settingsNavigation";
import { useLeaveSettings } from "./useLeaveSettings";

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
  /** Reachable by path (and titled) but left out of the menu. */
  hideFromNavigation?: boolean;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { label: "Providers", to: "/settings/providers", icon: BotIcon },
  { label: "Source Control", to: "/settings/source-control", icon: GitBranchIcon },
  { label: "Connections", to: "/settings/connections", icon: Link2Icon },
  // No experiments are running; the page stays for when one is.
  { label: "Beta", to: "/settings/beta", icon: FlaskConicalIcon, hideFromNavigation: true },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

/** Core sections plus product-contributed settings pages, in menu order. */
export function useSettingsNavigationEntries(): SettingsNavigationEntry[] {
  const composition = useWebProductComposition();
  return resolveSettingsNavigationEntries({
    coreItems: SETTINGS_NAV_ITEMS,
    featurePages: listExperimentalWebSettings(composition),
  });
}

/**
 * The settings section rows. The sidebar nav and the phone section list both
 * render them, so the two lists keep one look.
 */
export function SettingsNavigationMenu(props: {
  entries: ReadonlyArray<SettingsNavigationEntry>;
  pathname: string;
  onSelect: (to: string) => void;
}) {
  return (
    <SidebarMenu className="gap-0.5">
      {props.entries.map((item) => {
        const Icon = item.icon;
        const isActive = props.pathname === item.to;
        return (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton
              size="sm"
              isActive={isActive}
              className={
                isActive
                  ? "h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86 dark:data-[active=true]:text-white/82"
                  : `h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground dark:hover:text-white/86 ${SIDEBAR_MUTED_TEXT_CLASS}`
              }
              onClick={() => props.onSelect(item.to)}
            >
              {Icon ? <Icon className="size-4 shrink-0" /> : null}
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
  );
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const entries = useSettingsNavigationEntries();
  const handleSectionClick = useCallback(
    (to: string) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to: to as SettingsSectionPath, replace: true });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const leaveSettings = useLeaveSettings();
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    leaveSettings();
  }, [isMobile, leaveSettings, setOpenMobile]);

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-2 pt-2 pb-2">
          <SettingsNavigationMenu
            entries={entries}
            pathname={pathname}
            onSelect={handleSectionClick}
          />
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <UpcomputerConnectSidebarSignIn />
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
          <UpcomputerConnectSidebarAvatar />
        </div>
      </SidebarFooter>
    </>
  );
}
