import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { resolveAvailableSidebarViewMode } from "./sidebar/sidebarViewMode";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 12 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 400;

// Deliberately not `./threadSidebarWidth`: upstream's module floors the sidebar
// at 13rem and main content at 40rem, both wider than this fork allows.
function resolveThreadSidebarMaximumWidth(viewportWidth: number): number {
  return Math.max(
    THREAD_SIDEBAR_MIN_WIDTH,
    Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH,
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const storedSidebarViewMode = useClientSettings((settings) => settings.sidebarViewMode);
  const sidebarViewMode = resolveAvailableSidebarViewMode(storedSidebarViewMode);
  const updateSettings = useUpdateClientSettings();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");

  useEffect(() => {
    if (storedSidebarViewMode !== sidebarViewMode) {
      updateSettings({ sidebarViewMode });
    }
  }, [sidebarViewMode, storedSidebarViewMode, updateSettings]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings" && !isOnSettings) {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [isOnSettings, navigate]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        // Deliberately use a fork-owned version hook: upstream's similarly named
        // attribute carries its whole opaque sidebar palette and hides our glass.
        data-upcomputer-sidebar-version="v1"
        data-sidebar-mode={sidebarViewMode}
        className="border-r border-black/[0.04] bg-transparent text-foreground dark:border-white/[0.03]"
        resizable={{
          maxWidth: resolveThreadSidebarMaximumWidth(window.innerWidth),
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          // `nextWidth <= currentWidth` comes first: a sidebar left wider than
          // the viewport (window shrunk, display changed) could otherwise never
          // be dragged back, because every candidate width already fails the
          // main-content floor. Shrinking is always allowed.
          shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
            nextWidth <= currentWidth ||
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
