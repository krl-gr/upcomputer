import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { it, vi } from "vite-plus/test";

import { SidebarProvider } from "../components/ui/sidebar";
import { __setClientSettingsForTests } from "../hooks/useSettings";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { SidebarProjectsSection } from "../sidebarProjects/SidebarProjectsSection";
import { ALL_PROJECTS_ROW_KEY } from "../sidebarProjects/sidebarProjects.logic";
import { SIDEBAR_ALL_PROJECTS_SELECTED_AT_STORAGE_KEY } from "../sidebarProjects/useSidebarProjectsList";
import { useUiStateStore } from "../uiStateStore";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");
const SCRATCH_ROOT = "/Users/me/.upcomputer/scratch";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

// Data sources, not UI: the server config that marks the Scratch project, and no threads,
// so each project sorts by its own timestamp.
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerConfigs: () =>
    new Map([["environment-ui-states", { scratchWorkspaceRoot: "/Users/me/.upcomputer/scratch" }]]),
  useQuietThreadShells: () => [],
  useDelegatedUnderParent: () => new Set(),
}));
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePrimaryEnvironmentId: () => "environment-ui-states",
}));

function project(
  id: string,
  title: string,
  updatedDaysAgo: number,
  icon: EnvironmentProject["projectIcon"],
  workspaceRoot = `/Users/me/code/${id}`,
): EnvironmentProject {
  return {
    id: ProjectId.make(id),
    environmentId: ENVIRONMENT_ID,
    title,
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    projectIcon: icon,
    scripts: [],
    createdAt: daysAgo(60),
    updatedAt: daysAgo(updatedDaysAgo),
  };
}

// In the sidebar's "updated_at" order, as useSidebarProjectGroups sorts them.
const PROJECTS = [
  project("upcomputer", "UpComputer", 1, { kind: "monogram", text: "UC", color: "blue" }),
  project("site", "Marketing site", 2, { kind: "monogram", text: "MS", color: "green" }),
  project("scratch", "Scratch", 3, null, SCRATCH_ROOT),
  project("docs", "Docs", 4, { kind: "monogram", text: "D", color: "orange" }),
  project("infra", "Infra", 5, { kind: "monogram", text: "IN", color: "purple" }),
];
const GROUPS = buildSidebarProjectSnapshots({
  projects: PROJECTS,
  settings: selectProjectGroupingSettings(DEFAULT_CLIENT_SETTINGS),
  groupScratchProjects: true,
  primaryEnvironmentId: ENVIRONMENT_ID,
  resolveEnvironmentLabel: () => null,
});
const keyOf = (id: string) => GROUPS.find((group) => group.id === id)!.projectKey;
const physicalKey = (id: string) =>
  GROUPS.find((group) => group.id === id)!.memberProjects[0]!.physicalProjectKey;

function section(
  name: string,
  options: {
    readonly selected?: string;
    /** When All projects was last picked; without it, a fresh install. */
    readonly allPickedDaysAgo?: number;
    /** Project ids in the manual order; the groups follow it, as useSidebarProjectGroups orders them. */
    readonly manualOrder?: ReadonlyArray<string>;
  },
): UiState {
  const manualOrder = options.manualOrder?.map((id) =>
    id === ALL_PROJECTS_ROW_KEY ? id : physicalKey(id),
  );
  const groups = options.manualOrder
    ? options.manualOrder.flatMap((id) => GROUPS.filter((group) => group.id === id))
    : GROUPS;
  return {
    name,
    render: () => (
      // The provider's wrapper fills the viewport in the app; a sheet cell fits its rows.
      <SidebarProvider className="min-h-0">
        <SidebarProjectsSection projectGroups={groups} onAddProject={() => undefined} loaded />
      </SidebarProvider>
    ),
    setup: () => {
      const previous = useUiStateStore.getState();
      useUiStateStore.setState({
        sidebarProjectScopeKeys: options.selected ? [keyOf(options.selected)] : [],
        projectOrder: manualOrder ?? [],
      });
      if (options.allPickedDaysAgo !== undefined) {
        window.localStorage.setItem(
          SIDEBAR_ALL_PROJECTS_SELECTED_AT_STORAGE_KEY,
          JSON.stringify(daysAgo(options.allPickedDaysAgo)),
        );
      }
      __setClientSettingsForTests({
        ...DEFAULT_CLIENT_SETTINGS,
        sidebarProjectSortOrder: options.manualOrder ? "manual" : "updated_at",
      });
      return () => {
        useUiStateStore.setState({
          sidebarProjectScopeKeys: previous.sidebarProjectScopeKeys,
          projectOrder: previous.projectOrder,
        });
        window.localStorage.removeItem(SIDEBAR_ALL_PROJECTS_SELECTED_AT_STORAGE_KEY);
        __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
      };
    },
  };
}

it("projects-section", async () => {
  await captureUiStateSheet("projects-section", [
    {
      title: "Updated order",
      states: [
        section("default: fresh install, All projects first", {}),
        section("All projects in More: picked 10 days ago, UpComputer selected", {
          selected: "upcomputer",
          allPickedDaysAgo: 10,
        }),
        section("selected project from More: Infra takes the last slot", {
          selected: "infra",
          allPickedDaysAgo: 10,
        }),
      ],
    },
    {
      title: "Manual order",
      states: [
        section("manual: Docs, All projects and No project dragged up, UpComputer selected", {
          selected: "upcomputer",
          manualOrder: ["docs", ALL_PROJECTS_ROW_KEY, "scratch", "upcomputer", "site", "infra"],
        }),
      ],
    },
  ]);
});
