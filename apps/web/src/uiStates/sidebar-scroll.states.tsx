import "../adaptiveSidebar/adaptiveSidebar.css";

import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { BotsSection } from "@t3tools/tasks-web/bots";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { SidebarChromeFooter, SidebarChromeHeader } from "../components/sidebar/SidebarChrome";
import {
  SidebarListSectionMarker,
  SidebarSectionPlaceholder,
} from "../components/sidebar/SidebarListMarkers";
import { SidebarThreadHeader } from "../components/sidebar/SidebarThreadHeader";
import { SidebarContent, SidebarGroup, SidebarProvider } from "../components/ui/sidebar";
import { ProductSidebarNavigation } from "../product/ProductSlots";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { SidebarProjectsSection } from "../sidebarProjects/SidebarProjectsSection";
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
 * tasks-web's Bots section over a fixture list, as `SidebarBots` does.
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
/** As many bots as the user who found the column could not scroll. */
const MANY_BOTS = [
  ...BOTS,
  ...["Tester", "Designer", "Analyst", "Editor", "Scheduler", "Researcher", "Translator"].map(
    (name) => bot(`bot-${name.toLowerCase()}`, name),
  ),
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

/** macOS draws its window buttons over the titlebar row; the sheet draws stand-ins. */
function TrafficLights() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-[calc(var(--workspace-topbar-height)/2-6px)] left-5 z-10 flex gap-2"
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
        <span key={color} className="size-3 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

function WholeSidebar(props: {
  readonly height: number;
  readonly compact?: boolean;
  readonly bots?: typeof BOTS;
  /** The desktop's translucent sidebar over a picture, as vibrancy shows it. */
  readonly translucent?: boolean;
}) {
  return (
    <SidebarProvider className="min-h-0" data-sidebar-compact={props.compact ? "true" : "false"}>
      <div
        data-app-sidebar=""
        className="relative -mx-(--sidebar-content-inset) -my-1 w-64"
        style={{
          height: props.height,
          ...(props.compact ? { width: SIDEBAR_COMPACT_WIDTH } : {}),
          ...(props.translucent
            ? {
                backgroundImage:
                  "repeating-linear-gradient(135deg, #3b6fd8 0 18px, #3f9a5b 18px 36px, #c9a43a 36px 54px)",
              }
            : {}),
        }}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className={
            props.translucent
              ? "flex h-full w-full flex-col bg-white/25 dark:bg-background/35"
              : "flex h-full w-full flex-col bg-sidebar surface-grain"
          }
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
              <BotsSection
                lists={[{ environmentId: ENVIRONMENT_ID, bots: props.bots ?? BOTS, error: "" }]}
              />
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
        <TrafficLights />
      </div>
    </SidebarProvider>
  );
}

function scroller(cell: HTMLElement) {
  return cell.querySelector<HTMLElement>(
    cell.querySelector("[data-sidebar-compact=true]")
      ? "[data-sidebar=sidebar]"
      : "[data-slot=scroll-area-viewport]",
  )!;
}

/** Scrolls until the row's middle is at the middle of the titlebar row: half faded. */
function scrollRowUnderTitlebar(row: (cell: HTMLElement) => HTMLElement) {
  return async (cell: HTMLElement) => {
    const scroll = scroller(cell);
    const target = row(cell);
    const titlebar = cell.querySelector<HTMLElement>("[data-sidebar-chrome-header]")!;
    const offset =
      target.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    await act(() => {
      scroll.scrollTop = offset + target.offsetHeight / 2 - titlebar.offsetHeight / 2;
    });
  };
}

const threadRowTitled = (title: string) => (cell: HTMLElement) =>
  [...cell.querySelectorAll<HTMLElement>("[data-thread-item]")].find((row) =>
    row.textContent?.includes(title),
  )!;

const nthListRow = (index: number) => (cell: HTMLElement) =>
  cell.querySelectorAll<HTMLElement>("[data-sidebar-list-row]")[index]!;

async function scrollToEnd(cell: HTMLElement) {
  const scroll = scroller(cell);
  await act(() => {
    scroll.scrollTop = scroll.scrollHeight;
  });
}

const STATES: ReadonlyArray<UiState> = [
  {
    name: "700px tall, at the top: nothing under the titlebar row, so no fade",
    render: () => <WholeSidebar height={700} />,
  },
  {
    name: "700px tall, scrolled to the middle: a row half faded under the titlebar row, rows fading under the footer",
    render: () => <WholeSidebar height={700} />,
    settle: scrollRowUnderTitlebar(threadRowTitled("Port the sidebar")),
  },
  {
    name: "700px tall, at the end: nothing under the footer, so no fade",
    render: () => <WholeSidebar height={700} />,
    settle: scrollToEnd,
  },
  {
    name: "translucent over a picture, scrolled to the middle: the fade shows the picture, no slab",
    render: () => <WholeSidebar height={420} translucent />,
    settle: scrollRowUnderTitlebar(threadRowTitled("Port the sidebar")),
  },
  {
    name: "420px tall, at the top: the footer keeps its full height",
    render: () => <WholeSidebar height={420} />,
  },
  {
    name: "420px tall, scrolled to the middle",
    render: () => <WholeSidebar height={420} />,
    settle: scrollRowUnderTitlebar(threadRowTitled("Release checklist")),
  },
];

/** Wheels over the row, as a mouse or trackpad does, and checks the whole column scrolled. */
function wheelOver(row: (cell: HTMLElement) => HTMLElement, deltaY: number) {
  return async (cell: HTMLElement) => {
    const column = scroller(cell);
    const before = column.scrollTop;
    await userEvent.wheel(row(cell), { delta: { y: deltaY } });
    await vi.waitFor(() => expect(column.scrollTop).toBeGreaterThan(before));
  };
}

async function wheelToEnd(cell: HTMLElement) {
  const column = scroller(cell);
  await wheelOver(nthListRow(2), 4000)(cell);
  await vi.waitFor(() => expect(column.scrollTop).toBe(column.scrollHeight - column.clientHeight));
  const box = column.getBoundingClientRect();
  const bots = cell.querySelectorAll<HTMLElement>("[data-sidebar-list-row]");
  const footerButtons = cell.querySelectorAll<HTMLElement>(
    "[data-sidebar=footer] [data-sidebar=menu-button]",
  );
  for (const target of [
    bots[bots.length - 1]!,
    cell.querySelector<HTMLElement>("[data-sidebar-compact-new-thread]")!,
    cell.querySelector<HTMLElement>("[data-track='sidebar.settings']")!,
    footerButtons[footerButtons.length - 1]!,
  ]) {
    const rect = target.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(box.top);
    expect(rect.bottom).toBeLessThanOrEqual(box.bottom);
  }
}

const COMPACT_STATES: ReadonlyArray<UiState> = [
  {
    name: "icon column, 700px tall, at the top: no fade",
    render: () => <WholeSidebar height={700} compact />,
  },
  {
    name: "icon column, 420px tall, scrolled: a bot half faded under the titlebar row",
    render: () => <WholeSidebar height={420} compact />,
    settle: scrollRowUnderTitlebar(nthListRow(1)),
  },
  {
    name: "icon column, scrolled to the end: New thread, then the footer",
    render: () => <WholeSidebar height={700} compact />,
    settle: scrollToEnd,
  },
  {
    name: "icon column, 700px tall, 12 bots, wheeled over a bot: the whole column scrolls",
    render: () => <WholeSidebar height={700} compact bots={MANY_BOTS} />,
    settle: wheelOver(nthListRow(4), 160),
  },
  {
    name: "icon column, 700px tall, 12 bots, wheeled to the end: the last bot, New thread and the footer",
    render: () => <WholeSidebar height={700} compact bots={MANY_BOTS} />,
    settle: wheelToEnd,
  },
];

it("sidebar-scroll", async () => {
  // Two sheets: a taller capture comes out blank past about 4000px.
  await captureUiStateSheet("sidebar-scroll", [{ title: "Whole sidebar", states: STATES }]);
  await captureUiStateSheet("sidebar-scroll-compact", [
    { title: "Icon column", states: COMPACT_STATES },
  ]);
});
