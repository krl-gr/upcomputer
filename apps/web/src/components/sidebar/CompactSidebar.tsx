import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useLegacySidebarEnabled } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { shortcutLabelForCommand } from "../../keybindings";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { cn } from "../../lib/utils";
import {
  ProductCompactSidebarNavigation,
  ProductCompactSidebarSections,
} from "../../product/ProductSlots";
import { productSurface } from "../../product/productFlags";
import { SidebarProjectsMore } from "../../sidebarProjects/SidebarProjectsSection";
import { newThreadStartsWithoutProject } from "../../sidebarProjects/SidebarThreadsSection";
import {
  AllProjectsIcon,
  NoProjectIcon,
  ProjectRowIcon,
  useSidebarProjectsRows,
} from "../../sidebarProjects/sidebarProjectIcons";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { usePrimaryEnvironmentId, usePullRequestsSupported } from "../../state/environments";
import { useUiStateStore } from "../../uiStateStore";
import { shouldCreateNewThreadInCurrentProject } from "../Sidebar.logic";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { useSidebar } from "../ui/sidebar";
import { CompactSidebarButton, CompactSidebarPill } from "./CompactSidebarPill";

/**
 * The sidebar as icons, in a column at the main area's left edge while the
 * desktop sidebar is hidden. It takes layout space rather than floating, so
 * nothing in the main area slides under it. Phones keep their sheet.
 */
export function CompactSidebar() {
  const { isMobile, open } = useSidebar();
  const shown = !isMobile && !open;
  return (
    <div
      className={cn(
        "relative hidden shrink-0 overflow-hidden bg-background surface-grain md:block",
        "[[data-panel-animations=true]_&]:motion-safe:transition-[width] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        shown ? "w-(--compact-sidebar-width)" : "w-0",
      )}
      data-compact-sidebar=""
      data-state={shown ? "shown" : "hidden"}
    >
      {shown ? <CompactSidebarContent /> : null}
    </div>
  );
}

function CompactSidebarContent() {
  return (
    <nav
      aria-label="Compact sidebar"
      className="absolute inset-y-0 left-0 flex w-(--compact-sidebar-width) flex-col"
    >
      {/* Under the fixed sidebar toggle; in the desktop app it drags the window like the topbar. */}
      <div className={cn("h-(--workspace-topbar-height) shrink-0", isElectron && "drag-region")} />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-2 [scrollbar-width:none]">
        <CompactSearch />
        <ProductCompactSidebarNavigation />
        {productSurface("sidebarProjects") === "upcomputer" ? <CompactProjects /> : null}
        <ProductCompactSidebarSections />
        <CompactThreads />
      </div>
      <div className="flex shrink-0 flex-col items-center pt-2 pb-3">
        <CompactUtilities />
      </div>
    </nav>
  );
}

function CompactSearch() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  return (
    <CompactSidebarPill label="Search">
      {/* The sidebar's search field needs the sidebar; the command palette searches without it. */}
      <CompactSidebarButton
        label="Search"
        tooltip={shortcutLabel ? `Search (${shortcutLabel})` : "Search"}
        onClick={() => openCommandPalette()}
      >
        <SearchIcon />
      </CompactSidebarButton>
    </CompactSidebarPill>
  );
}

/**
 * The Projects section's rows as icons. A row sets the thread list's project
 * scope, so choosing one also opens the sidebar, where that list is.
 */
function CompactProjects() {
  const navigate = useNavigate();
  const { setOpen } = useSidebar();
  const projectGroups = useSidebarProjectGroups();
  const scopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const rows = useSidebarProjectsRows(projectGroups, scopeKey);
  const selectScope = (projectKey: string | null) => {
    setScopeKey(projectKey);
    void setOpen(true);
  };
  const openProjectSettings = (project: SidebarProjectSnapshot) => {
    void navigate({ to: "/projects/$projectKey", params: { projectKey: project.projectKey } });
  };
  return (
    <CompactSidebarPill label="Projects">
      {projectGroups.length > 0 ? (
        <>
          <CompactSidebarButton
            label="All projects"
            isActive={scopeKey === null}
            onClick={() => selectScope(null)}
          >
            <AllProjectsIcon />
          </CompactSidebarButton>
          {rows.preview.map((project) => (
            <CompactSidebarButton
              key={project.projectKey}
              label={project.displayName}
              isActive={scopeKey === project.projectKey}
              onClick={() => selectScope(project.projectKey)}
            >
              <ProjectRowIcon project={project} />
            </CompactSidebarButton>
          ))}
          {rows.scratch ? (
            <CompactSidebarButton
              label="No project"
              isActive={scopeKey === rows.scratch.projectKey}
              onClick={() => selectScope(rows.scratch?.projectKey ?? null)}
            >
              <NoProjectIcon />
            </CompactSidebarButton>
          ) : null}
          {rows.overflow.length > 0 ? (
            <SidebarProjectsMore
              compact
              projects={rows.overflow}
              onSelect={selectScope}
              onOpenProjectSettings={openProjectSettings}
            />
          ) : null}
        </>
      ) : null}
      <CompactSidebarButton
        label="Add project"
        onClick={() => openCommandPalette({ open: "add-project" })}
      >
        <PlusIcon />
      </CompactSidebarButton>
    </CompactSidebarPill>
  );
}

/**
 * The Threads section keeps only its New thread action: thread rows need
 * their titles to be told apart, and the open thread is already on screen.
 * New thread runs what the sidebar's own button runs.
 */
function CompactThreads() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const projectGroups = useSidebarProjectGroups();
  const newThreadContext = useHandleNewThread();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "chat.new");
  const startNewThread = (event: ReactMouseEvent) => {
    const scratchTarget = newThreadStartsWithoutProject(legacySidebarEnabled)
      ? scratchEnvironmentId(
          newThreadContext.activeThread?.environmentId ??
            newThreadContext.activeDraftThread?.environmentId ??
            primaryEnvironmentId,
        )
      : null;
    if (!event.shiftKey && scratchTarget !== null) {
      void startScratchThread(scratchTarget);
      return;
    }
    if (shouldCreateNewThreadInCurrentProject(event.shiftKey, projectGroups.length)) {
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    openCommandPalette({ open: "new-thread-in" });
  };
  return (
    <CompactSidebarPill label="Threads">
      <CompactSidebarButton
        label="New thread"
        tooltip={shortcutLabel ? `New thread (${shortcutLabel})` : "New thread"}
        onClick={startNewThread}
      >
        <SquarePenIcon />
      </CompactSidebarButton>
    </CompactSidebarPill>
  );
}

/** The sidebar footer's Settings, Pull Requests and Usage, pinned to the bottom like the footer. */
function CompactUtilities() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const pullRequestsSupported = usePullRequestsSupported();
  const isOn = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  return (
    <CompactSidebarPill label="Utilities">
      <CompactSidebarButton
        label="Settings"
        isActive={isOn("/settings")}
        onClick={() => void navigate({ to: "/settings" })}
      >
        <SettingsIcon />
      </CompactSidebarButton>
      {pullRequestsSupported ? (
        <CompactSidebarButton
          label="Pull Requests"
          isActive={isOn("/pull-requests")}
          onClick={() =>
            void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() })
          }
        >
          <PullRequestGlyph.pullRequest />
        </CompactSidebarButton>
      ) : null}
      <CompactSidebarButton
        label="Usage"
        isActive={isOn("/usage")}
        onClick={() => void navigate({ to: "/usage" })}
      >
        <ChartNoAxesColumnIcon />
      </CompactSidebarButton>
    </CompactSidebarPill>
  );
}
