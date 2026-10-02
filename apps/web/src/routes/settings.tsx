import { ChevronLeftIcon, RotateCcwIcon } from "lucide-react";
import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useSettingsRestore } from "../components/settings/SettingsPanels";
import { SettingsSectionList } from "../components/settings/SettingsSectionList";
import { resolveSettingsHeaderClassName } from "../components/settings/settingsHeaderLayout";
import { useLeaveSettings } from "../components/settings/useLeaveSettings";
import { SETTINGS_NAV_ITEMS } from "../components/settings/SettingsSidebarNav";
import {
  DEFAULT_SETTINGS_SECTION_PATH,
  resolveSettingsIndexTarget,
  SETTINGS_SECTION_LIST_PATH,
} from "../components/settings/settingsNavigation";
import { Button } from "../components/ui/button";
import { SidebarInset, useSidebar } from "../components/ui/sidebar";
import { isElectron } from "../env";
import { isMobileViewport } from "../hooks/useMediaQuery";
import { listExperimentalWebSettings, useWebProductComposition } from "../product/WebComposition";

function RestoreDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);

  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      Restore defaults
    </Button>
  );
}

/**
 * Phones have no settings sidebar: the section list is the way in, and the
 * header steps back up one level (section → list → last chat).
 */
function MobileSettingsBackButton(props: { isSectionList: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.isSectionList ? "Back to chat" : "Back to settings"}
      className="-ms-1.5 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md pe-2 ps-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [-webkit-app-region:no-drag]"
      onClick={props.onClick}
    >
      <ChevronLeftIcon aria-hidden="true" className="size-5" />
      {props.isSectionList ? null : <span>Settings</span>}
    </button>
  );
}

function SettingsContentLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const composition = useWebProductComposition();
  const { isMobile } = useSidebar();
  const [restoreSignal, setRestoreSignal] = useState(0);
  const isSectionList = location.pathname === SETTINGS_SECTION_LIST_PATH;
  const indexTarget = resolveSettingsIndexTarget({ isMobile });
  const showRestoreDefaults = location.pathname === "/settings/general";
  const activeSettingsTitle =
    SETTINGS_NAV_ITEMS.find((item) => item.to === location.pathname)?.label ??
    listExperimentalWebSettings(composition).find(({ page }) => page.path === location.pathname)
      ?.page.label ??
    (location.pathname === "/settings/diagnostics" ? "Diagnostics" : "Settings");
  const handleRestored = () => setRestoreSignal((value) => value + 1);
  const navigateBackWithinApp = useLeaveSettings();
  const navigateToSectionList = useCallback(() => {
    void navigate({ to: SETTINGS_SECTION_LIST_PATH, replace: true });
  }, [navigate]);
  const navigateBack = isMobile && !isSectionList ? navigateToSectionList : navigateBackWithinApp;

  // Widening a phone past the breakpoint on the list leaves the sidebar nav
  // in charge again, which opens General like the route guard does.
  useEffect(() => {
    if (isSectionList && indexTarget !== "section-list") {
      void navigate({ to: indexTarget, replace: true });
    }
  }, [indexTarget, isSectionList, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        navigateBack();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigateBack]);

  const backButton = isMobile ? (
    <MobileSettingsBackButton isSectionList={isSectionList} onClick={navigateBack} />
  ) : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className={resolveSettingsHeaderClassName({ isElectron, isMobile })}>
            <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
              {backButton}
              <h1 className="text-sm font-medium text-foreground">{activeSettingsTitle}</h1>
              {showRestoreDefaults ? (
                <div className="ms-auto flex items-center gap-2">
                  <RestoreDefaultsButton onRestored={handleRestored} />
                </div>
              ) : null}
            </div>
          </header>
        )}

        {isElectron && (
          <div className={resolveSettingsHeaderClassName({ isElectron, isMobile })}>
            {backButton}
            <h1 className="text-xs font-medium tracking-wide text-muted-foreground/70">
              {activeSettingsTitle}
            </h1>
            {showRestoreDefaults ? (
              <div className="ms-auto flex items-center gap-2">
                <RestoreDefaultsButton onRestored={handleRestored} />
              </div>
            ) : null}
          </div>
        )}

        <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col">
          {isSectionList ? isMobile ? <SettingsSectionList /> : null : <Outlet />}
        </div>
      </div>
    </SidebarInset>
  );
}

function SettingsRouteLayout() {
  return <SettingsContentLayout />;
}

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }

    if (
      location.pathname === SETTINGS_SECTION_LIST_PATH &&
      resolveSettingsIndexTarget({ isMobile: isMobileViewport() }) !== "section-list"
    ) {
      throw redirect({ to: DEFAULT_SETTINGS_SECTION_PATH, replace: true });
    }
  },
  component: SettingsRouteLayout,
});
