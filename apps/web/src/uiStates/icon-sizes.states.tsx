import { defaultBotAppearance } from "@t3tools/tasks-contracts/v1";
import { EllipsisIcon } from "lucide-react";
import { it, vi } from "vite-plus/test";

import { SidebarThreadHeader } from "../components/sidebar/SidebarThreadHeader";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "../components/ui/sidebar";
import { ProductSidebarNavigation } from "../product/ProductSlots";
import { SIDEBAR_MENU_SCOPE } from "../sidebarMetrics/sidebarMetrics";
import { SidebarProjectRow } from "../sidebarProjects/SidebarProjectRow";
import { SidebarSectionHeader } from "../sidebarProjects/SidebarSectionHeader";
import {
  AllProjectsIcon,
  NoProjectIcon,
  ProjectRowIcon,
} from "../sidebarProjects/sidebarProjectIcons";
import {
  FAVICON_PROJECT,
  LINKED_PROJECT_IDS,
  PROJECT,
  SCRATCH,
  STATUS_WIRE,
  bot,
  threadShell,
} from "./sidebarRowFixtures";
import { botState, noop, threadRow, threadRowProps, waitForImages } from "./sidebarRowStates";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

// Data sources, not UI, as in sidebar-rows.states.tsx; here the favicon project's
// favicon also resolves, to the fixture PNG.
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
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  const client = {
    tasks: {
      subscribe: () => () => undefined,
      threadRunCounts: async () => ({ threads: [] }),
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
vi.mock("../state/assets", async (importOriginal) => {
  const { Atom } = await import("effect/reactivity");
  const { FAVICON_PROJECT } = await import("./sidebarRowFixtures");
  const { default: faviconUrl } = await import("./raster-favicon-32.png?inline");
  const favicon = Atom.make<string | null>(faviconUrl);
  const none = Atom.make<string | null>(null);
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    projectFaviconUrlAtom: (target: { readonly cwd: string }) =>
      target.cwd === FAVICON_PROJECT.workspaceRoot ? favicon : none,
  };
});

const searchInputRef = { current: null };

/** `SidebarMenuButton` reads the sidebar's context; its wrapper keeps block layout and no full height. */
function sidebar(children: React.ReactNode) {
  return <SidebarProvider className="block min-h-0">{children}</SidebarProvider>;
}

function menu(children: React.ReactNode) {
  return sidebar(
    <div className={SIDEBAR_MENU_SCOPE}>
      <SidebarMenu>{children}</SidebarMenu>
    </div>,
  );
}

function projectRow(label: string, icon: React.ReactNode, menuItems = true): UiState {
  return {
    name: label,
    render: () =>
      menu(
        <SidebarMenuItem>
          <SidebarProjectRow
            label={label}
            icon={icon}
            isActive={false}
            newChatLabel={`New chat in ${label}`}
            onSelect={noop}
            onNewChat={noop}
            {...(menuItems ? { menuLabel: `Project actions for ${label}`, menuItems: <></> } : {})}
          />
        </SidebarMenuItem>,
      ),
    settle: (cell) => waitForImages(cell),
  };
}

const TOP_MENU_STATES: ReadonlyArray<UiState> = [
  {
    name: "Search",
    render: () => (
      <SidebarThreadHeader
        hasProjects
        projectScope={null}
        onNewProject={noop}
        onNewThread={noop}
        newThreadDisabled={false}
        newThreadShortcutLabel={null}
        newThreadInProjectShortcutLabel={null}
        showNewThreadInProjectHint={false}
        searchInputRef={searchInputRef}
        searchQuery=""
        onSearchQueryChange={noop}
        onSearchKeyDown={noop}
        isSearching={false}
        searchResultCount={0}
        activeSearchResultIndex={0}
        onClearSearch={noop}
      />
    ),
  },
  {
    name: "Tasks",
    render: () => sidebar(<ProductSidebarNavigation />),
  },
];

const PROJECT_STATES: ReadonlyArray<UiState> = [
  {
    name: "section header (chevron)",
    render: () => <SidebarSectionHeader title="Projects" open onToggle={noop} />,
  },
  {
    name: "All projects",
    render: () =>
      menu(
        <SidebarMenuItem>
          <SidebarMenuButton>
            <AllProjectsIcon />
            <span className="flex-1 truncate">All projects</span>
          </SidebarMenuButton>
        </SidebarMenuItem>,
      ),
  },
  projectRow(PROJECT.title, <ProjectRowIcon project={PROJECT} />),
  projectRow(FAVICON_PROJECT.title, <ProjectRowIcon project={FAVICON_PROJECT} />),
  projectRow("No project", <NoProjectIcon />, false),
  {
    ...projectRow(PROJECT.title, <ProjectRowIcon project={PROJECT} />),
    name: "hover (… and new chat buttons)",
    hover: "[data-sidebar=menu-button]",
  },
  {
    name: "More",
    render: () =>
      menu(
        <SidebarMenuItem>
          <SidebarMenuButton>
            <EllipsisIcon />
            <span className="flex-1 truncate">More</span>
          </SidebarMenuButton>
        </SidebarMenuItem>,
      ),
  },
];

const plain = threadShell("thread-plain", "Fix flaky checkout test");

const THREAD_STATES: ReadonlyArray<UiState> = [
  { name: "1 project", render: threadRow(threadRowProps(plain)) },
  {
    name: "2 projects",
    render: threadRow(
      threadRowProps(
        threadShell("thread-linked-2", "Share the pricing table", {
          linkedProjectIds: [LINKED_PROJECT_IDS.site],
        }),
      ),
    ),
  },
  {
    name: "3 projects",
    render: threadRow(
      threadRowProps(
        threadShell("thread-linked-3", "Document the pricing table", {
          linkedProjectIds: [LINKED_PROJECT_IDS.site, LINKED_PROJECT_IDS.docs],
        }),
      ),
    ),
  },
  {
    name: "raster favicon project",
    render: threadRow(
      threadRowProps(threadShell("thread-favicon", "Refresh the landing page"), {
        project: FAVICON_PROJECT,
        projectDisplayName: FAVICON_PROJECT.title,
      }),
    ),
    settle: (cell) => waitForImages(cell),
  },
  {
    name: "no project",
    render: threadRow(
      threadRowProps(threadShell("thread-scratch", "Plan the week", { projectId: SCRATCH.id }), {
        project: SCRATCH,
        projectDisplayName: null,
      }),
    ),
  },
  {
    name: "status label (Working)",
    render: threadRow(
      threadRowProps(
        threadShell("thread-working", "Refactor the sidebar list", STATUS_WIRE.Working),
      ),
    ),
  },
  {
    name: "hover (… button)",
    render: threadRow(threadRowProps(plain)),
    hover: "[data-testid=sidebar-row-compact]",
  },
];

const BOT_STATES: ReadonlyArray<UiState> = [
  botState("portrait, idle", bot("bot-idle", "Scout")),
  botState("portrait, working", bot("bot-working", "Builder")),
  botState("shape character, idle", {
    ...bot("bot-character", "Courier"),
    appearance: { ...defaultBotAppearance("bot-character"), style: "character" },
  }),
  botState("hover (settings button)", bot("bot-idle", "Scout"), { hover: true }),
];

it("icon-sizes", async () => {
  await captureUiStateSheet(
    "icon-sizes",
    [
      { title: "Top menu", states: TOP_MENU_STATES },
      { title: "Projects section", states: PROJECT_STATES },
      { title: "Thread rows", states: THREAD_STATES },
      { title: "Bot rows", states: BOT_STATES },
    ],
    {
      columns: ["16px", "18px", "20px"].map((size) => ({
        title: `${size}${size === "16px" ? " (today)" : ""}`,
        variables: { "--sidebar-icon-size": size },
      })),
      densities: ["retina", "nonretina"],
    },
  );
});
