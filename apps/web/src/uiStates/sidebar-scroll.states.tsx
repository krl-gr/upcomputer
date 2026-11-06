import "../adaptiveSidebar/adaptiveSidebar.css";

import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { BotRow } from "@t3tools/tasks-web/bots";
import { it, vi } from "vite-plus/test";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { SidebarChromeFooter, SidebarChromeHeader } from "../components/sidebar/SidebarChrome";
import {
  SidebarListSectionMarker,
  SidebarSectionPlaceholder,
} from "../components/sidebar/SidebarListMarkers";
import { SidebarThreadHeader } from "../components/sidebar/SidebarThreadHeader";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "../components/ui/sidebar";
import { ProductSidebarNavigation } from "../product/ProductSlots";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import {
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../sidebarMetrics/sidebarMetrics";
import { SidebarProjectsSection } from "../sidebarProjects/SidebarProjectsSection";
import { SidebarSectionHeader } from "../sidebarProjects/SidebarSectionHeader";
import {
  SidebarPinnedSectionHeader,
  SidebarThreadsSectionHeader,
} from "../sidebarProjects/SidebarThreadsSection";
import {
  SidebarCompactThreadRow,
  type SidebarCompactThreadRowProps,
} from "../sidebarThreadRow/SidebarCompactThreadRow";
import { act } from "../../test/render";
import { ENVIRONMENT_ID, HOUR, PROJECTS, at, bot, threadShell } from "./sidebarRowFixtures";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The whole thread sidebar in a short window. It copies the composition of
 * `components/Sidebar.tsx`, whose data and stores a sheet cannot load, and draws
 * the Bots section as tasks-web's `SidebarBots` does.
 */

// Data sources, not UI, as in the sidebar-rows sheet: the projects, server config and
// bot chat shells the app would load, and the Tasks server's run counts.
vi.mock("../state/entities", async (importOriginal) => {
  const fixtures = await import("./sidebarRowFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useProjects: () => fixtures.PROJECTS,
    useServerConfigs: () =>
      new Map([
        [fixtures.ENVIRONMENT_ID, { scratchWorkspaceRoot: fixtures.SCRATCH_WORKSPACE_ROOT }],
      ]),
    useThreadShell: (ref: { readonly threadId: string } | null) => {
      const wire = ref ? fixtures.BOT_CHAT_WIRE[ref.threadId] : undefined;
      return ref && wire ? fixtures.threadShell(ref.threadId, "Chat", wire) : null;
    },
  };
});
vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async (importOriginal) => {
  const fixtures = await import("./sidebarRowFixtures");
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  const client = {
    tasks: {
      subscribe: () => () => undefined,
      threadRunCounts: async (input: { readonly threadIds: ReadonlyArray<string> }) => ({
        threads: input.threadIds.flatMap((threadId) => {
          const runCounts = fixtures.RUN_COUNTS[threadId];
          return runCounts ? [{ threadId, runCounts }] : [];
        }),
      }),
      markThreadsSeen: async () => undefined,
    },
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    readTasksWebAccess: () => resolveTasksWebAccess({ availability: "enabled" }),
    readTasksWebClient: () => client,
    useTasksWebAccessRevision: () => 0,
  };
});

const noop = () => undefined;

const PROJECT_GROUPS: ReadonlyArray<SidebarProjectSnapshot> = PROJECTS.map((project) => ({
  ...project,
  projectKey: `${project.environmentId}:${project.id}`,
  displayName: project.title,
  groupedProjectCount: 1,
  environmentPresence: "local-only",
  allRemoteMembersAreDesktopLocal: false,
  allRemoteMembersAreWsl: false,
  memberProjects: [{ ...project, physicalProjectKey: project.id }],
  memberProjectRefs: [{ environmentId: project.environmentId, projectId: project.id }],
  remoteEnvironmentLabels: [],
})) as unknown as ReadonlyArray<SidebarProjectSnapshot>;

const BOTS = [
  bot("bot-idle", "Scout"),
  bot("bot-working", "Builder"),
  bot("bot-attention", "Reviewer"),
  bot("bot-runs", "Planner"),
  bot("bot-writer", "Writer"),
];

const PINNED = ["Release checklist", "Weekly planning", "Pricing page copy"];
const THREADS = [
  "Fix flaky checkout test",
  "Port the sidebar to one scroll",
  "Review the release notes",
  "Plan the cutover",
  "Investigate the stale dist symlink",
  "Draft the onboarding email",
  "Update the pricing table",
  "Triage reviewer findings",
  "Bump the Electron version",
  "Write the migration guide",
  "Profile the thread list",
  "Answer the support ticket",
  "Rotate the relay certificate",
  "Clean up the task queue",
  "Check the nightly build",
  "Sketch the bots page",
  "Measure the cold start",
  "Rename the settings sections",
  "Audit the analytics events",
  "Reply to the design review",
];

function threadRow(thread: SidebarCompactThreadRowProps["thread"], isActive = false) {
  return (
    <SidebarCompactThreadRow
      key={thread.id}
      thread={thread}
      variantAction="settle"
      sweepAction={null}
      snoozeWakeLabelText={null}
      isActive={isActive}
      jumpLabel={null}
      project={PROJECTS[0]!}
      projectDisplayName={PROJECTS[0]!.title}
      onThreadClick={noop}
      onThreadActivate={noop}
      onStartRename={noop}
      onRenameTitleChange={noop}
      onCommitRename={noop}
      onCancelRename={noop}
      isRenaming={false}
      renamingTitle=""
      onContextMenu={noop}
    />
  );
}

function WholeSidebar(props: { readonly height: number; readonly compact?: boolean }) {
  return (
    <SidebarProvider className="min-h-0" data-sidebar-compact={props.compact ? "true" : "false"}>
      <div
        data-app-sidebar=""
        className="relative -mx-(--sidebar-content-inset) -my-1 w-64"
        style={{ height: props.height, ...(props.compact ? { width: SIDEBAR_COMPACT_WIDTH } : {}) }}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar surface-grain"
        >
          <SidebarChromeHeader isElectron={false} />
          <SidebarContent className="min-h-full">
            <SidebarGroup className="z-[1] -mb-(--sidebar-content-inset)">
              <SidebarThreadHeader
                hasProjects
                projectScope={null}
                onNewProject={noop}
                onNewThread={noop}
                newThreadDisabled={false}
                newThreadShortcutLabel={null}
                newThreadInProjectShortcutLabel={null}
                showNewThreadInProjectHint={false}
                searchInputRef={{ current: null }}
                searchQuery=""
                onSearchQueryChange={noop}
                onSearchKeyDown={noop}
                isSearching={false}
                searchResultCount={0}
                activeSearchResultIndex={0}
                onClearSearch={noop}
              />
              <ProductSidebarNavigation />
              <SidebarProjectsSection projectGroups={PROJECT_GROUPS} onAddProject={noop} loaded />
              <div className={SIDEBAR_SECTION_GAP}>
                <SidebarSectionHeader title="Bots" open onToggle={noop} />
              </div>
              <div className={`${SIDEBAR_SECTION_HEADER_GAP} ${SIDEBAR_MENU_SCOPE}`}>
                <SidebarMenu>
                  {BOTS.map((shown) => (
                    <SidebarMenuItem key={shown.agent.id}>
                      <BotRow
                        environmentId={ENVIRONMENT_ID}
                        bot={shown}
                        active={false}
                        onOpen={noop}
                        onSettings={noop}
                      />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
              <SidebarThreadsSectionHeader
                onNewThread={noop}
                currentEnvironmentId={null}
                newThreadDisabled={false}
                newThreadShortcutLabel={null}
                placement="compact-only"
              />
            </SidebarGroup>
            <SidebarGroup className="flex-1" role="presentation" data-sidebar-thread-list="">
              <DndContext>
                <SortableContext items={[]}>
                  <ul className="relative flex flex-1 flex-col gap-px">
                    <SidebarListSectionMarker marker="pinned-header">
                      <SidebarPinnedSectionHeader />
                    </SidebarListSectionMarker>
                    {PINNED.map((title, index) =>
                      threadRow(
                        threadShell(`pinned-${index}`, title, {
                          pinnedAt: at(-(index + 1) * HOUR),
                        }),
                      ),
                    )}
                    <SidebarListSectionMarker marker="pinned-divider">
                      <div className="sidebar-drag-boundary-label">
                        <SidebarThreadsSectionHeader
                          onNewThread={noop}
                          currentEnvironmentId={null}
                          newThreadDisabled={false}
                          newThreadShortcutLabel={null}
                          placement="list"
                        />
                      </div>
                    </SidebarListSectionMarker>
                    <SidebarSectionPlaceholder
                      marker="active-placeholder"
                      label="Active"
                      showHint={false}
                      isDropTarget={false}
                    />
                    {THREADS.map((title, index) =>
                      threadRow(threadShell(`thread-${index}`, title), index === 4),
                    )}
                  </ul>
                </SortableContext>
              </DndContext>
            </SidebarGroup>
          </SidebarContent>
          <SidebarChromeFooter />
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Scrolls the sidebar so `rowsAbove` rows of a section have passed under its header. */
function scrollInto(marker: "pinned-header" | "pinned-divider", rowsAbove: number) {
  return async (cell: HTMLElement) => {
    const viewport = cell.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")!;
    const header = cell.querySelector<HTMLElement>(`[data-testid=sidebar-${marker}]`)!;
    const firstRow = header.nextElementSibling as HTMLElement;
    const offset =
      header.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop;
    await act(() => {
      viewport.scrollTop = offset + rowsAbove * (firstRow.offsetHeight + 1) + 14;
    });
  };
}

const STATES: ReadonlyArray<UiState> = [
  { name: "700px tall, at the top", render: () => <WholeSidebar height={700} /> },
  {
    name: "700px tall, scrolled into Pinned: its header stays",
    render: () => <WholeSidebar height={700} />,
    settle: scrollInto("pinned-header", 1),
  },
  {
    name: "700px tall, scrolled into Threads: its header covers Pinned's",
    render: () => <WholeSidebar height={700} />,
    settle: scrollInto("pinned-divider", 3),
  },
  {
    name: "420px tall: the footer keeps its full height",
    render: () => <WholeSidebar height={420} />,
  },
  {
    name: "icon column, 700px tall: scrolls as one with its footer, list left out",
    render: () => <WholeSidebar height={700} compact />,
  },
  {
    name: "icon column, scrolled to the end: New thread, then the footer",
    render: () => <WholeSidebar height={700} compact />,
    settle: async (cell) => {
      const column = cell.querySelector<HTMLElement>("[data-sidebar=sidebar]")!;
      await act(() => {
        column.scrollTop = column.scrollHeight;
      });
    },
  },
];

it("sidebar-scroll", async () => {
  await captureUiStateSheet("sidebar-scroll", [{ title: "Whole sidebar", states: STATES }]);
});
