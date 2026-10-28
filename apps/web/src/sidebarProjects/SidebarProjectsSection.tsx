import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CopyIcon, EllipsisIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useReducer } from "react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import {
  filterSidebarProjectScopeItems,
  reduceSidebarProjectScopeMenuState,
} from "../components/Sidebar.logic";
import { CompactSidebarButton } from "../components/sidebar/CompactSidebarPill";
import { Collapsible, CollapsiblePanel } from "../components/ui/collapsible";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../components/ui/combobox";
import { MenuItem } from "../components/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { useUiStateStore } from "../uiStateStore";
import { cn } from "../lib/utils";
import {
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../sidebarMetrics/sidebarMetrics";
import { SidebarProjectRow } from "./SidebarProjectRow";
import { SidebarSectionHeader, SidebarSectionHeaderAction } from "./SidebarSectionHeader";
import {
  AllProjectsIcon,
  NoProjectIcon,
  ProjectRowIcon,
  useSidebarProjectsRows,
} from "./sidebarProjectIcons";
import { errorToastDescription } from "~/components/errors/ErrorDetails";

export const SIDEBAR_PROJECTS_OPEN_STORAGE_KEY = "upcomputer:sidebar-projects-open";

interface ProjectItem {
  readonly value: string;
  readonly label: string;
}

/**
 * The sidebar's Projects section (UpComputer surface `sidebarProjects`): All
 * projects, the first projects in the sidebar's project order, No project and
 * More. Every row sets upstream's project scope, so the thread list filters
 * exactly as the header's scope menu does; the header hides that menu while
 * this surface is on, and its Add project button moves here.
 */
export function SidebarProjectsSection(props: {
  /** The sidebar's project groups, in its project sort order. */
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  /** Upstream's add project action, which the search row runs without this surface. */
  readonly onAddProject: () => void;
}) {
  const { projectGroups, onAddProject } = props;
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleNewThread = useNewThreadHandler();
  const scopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const [open, setOpen] = useLocalStorage(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, true, Schema.Boolean);

  const rows = useSidebarProjectsRows(projectGroups, scopeKey);
  const selectedProject = projectGroups.find((group) => group.projectKey === scopeKey) ?? null;

  const openProjectSettings = (project: SidebarProjectSnapshot) => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({
      to: "/projects/$projectKey",
      params: { projectKey: project.projectKey },
    });
  };
  const startNewThread = (project: SidebarProjectSnapshot) => {
    if (isMobile) setOpenMobile(false);
    void handleNewThread(scopeProjectRef(project.environmentId, project.id));
  };
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "Path copied", description: path });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: errorToastDescription(error),
        }),
      );
    },
  });

  return (
    <Collapsible open={open}>
      <div className={SIDEBAR_SECTION_GAP}>
        <SidebarSectionHeader
          title="Projects"
          open={open}
          onToggle={() => setOpen(!open)}
          testId="sidebar-projects-toggle"
          accessory={
            // Collapsed, the header still names an active filter.
            !open && selectedProject ? (
              <>
                {selectedProject === rows.scratch ? null : (
                  <ProjectFavicon project={selectedProject} className="size-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {selectedProject === rows.scratch ? "No project" : selectedProject.displayName}
                </span>
              </>
            ) : null
          }
          action={
            <SidebarSectionHeaderAction
              label="Add project"
              track="sidebar.add_project"
              onClick={onAddProject}
            >
              <PlusIcon className="size-3.5" />
            </SidebarSectionHeaderAction>
          }
        />
      </div>
      {/* With no projects the header stays, so Add project is always one click away. */}
      {projectGroups.length === 0 ? null : (
        <CollapsiblePanel>
          <div className={cn(SIDEBAR_SECTION_HEADER_GAP, SIDEBAR_MENU_SCOPE)}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={scopeKey === null} onClick={() => setScopeKey(null)}>
                  <AllProjectsIcon />
                  <span className="flex-1 truncate">All projects</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {rows.preview.map((project) => (
                <SidebarMenuItem key={project.projectKey}>
                  <SidebarProjectRow
                    label={project.displayName}
                    icon={<ProjectRowIcon project={project} />}
                    isActive={scopeKey === project.projectKey}
                    onSelect={() => setScopeKey(project.projectKey)}
                    newChatLabel={`New chat in ${project.displayName}`}
                    onNewChat={() => startNewThread(project)}
                    menuLabel={`Project actions for ${project.displayName}`}
                    menuItems={
                      <>
                        <MenuItem onClick={() => openProjectSettings(project)}>
                          <SettingsIcon />
                          Project settings
                        </MenuItem>
                        <MenuItem
                          onClick={() =>
                            copyPathToClipboard(project.workspaceRoot, {
                              path: project.workspaceRoot,
                            })
                          }
                        >
                          <CopyIcon />
                          Copy path
                        </MenuItem>
                      </>
                    }
                  />
                </SidebarMenuItem>
              ))}
              {rows.scratch ? (
                <SidebarMenuItem>
                  <SidebarProjectRow
                    label="No project"
                    icon={<NoProjectIcon />}
                    isActive={scopeKey === rows.scratch.projectKey}
                    onSelect={() => setScopeKey(rows.scratch?.projectKey ?? null)}
                    newChatLabel="New chat without a project"
                    onNewChat={() => rows.scratch && startNewThread(rows.scratch)}
                  />
                </SidebarMenuItem>
              ) : null}
              {rows.overflow.length > 0 ? (
                <SidebarMenuItem>
                  <SidebarProjectsMore
                    projects={rows.overflow}
                    onSelect={setScopeKey}
                    onOpenProjectSettings={openProjectSettings}
                  />
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </div>
        </CollapsiblePanel>
      )}
    </Collapsible>
  );
}

/**
 * "More": upstream's scope menu shape (search, then projects) over the
 * remaining projects. As in upstream's menu, right-click opens a project's settings.
 * The compact sidebar shows it as an icon button that opens the menu to its right.
 */
export function SidebarProjectsMore(props: {
  readonly projects: ReadonlyArray<SidebarProjectSnapshot>;
  readonly onSelect: (projectKey: string) => void;
  readonly onOpenProjectSettings: (project: SidebarProjectSnapshot) => void;
  readonly compact?: boolean;
}) {
  const { projects, onSelect, onOpenProjectSettings, compact = false } = props;
  const [menuState, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const items = projects.map((project) => ({
    value: project.projectKey,
    label: project.displayName,
  }));
  const projectByKey = new Map(projects.map((project) => [project.projectKey, project] as const));
  const filteredItems = filterSidebarProjectScopeItems({
    items,
    query: menuState.query,
    matches: (item, query) => filter.contains(item, query, (candidate) => candidate.label),
  });
  return (
    <Combobox<ProjectItem>
      items={items}
      filteredItems={filteredItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={menuState.open}
      onOpenChange={(open) => dispatchMenu({ type: "open-changed", open })}
      value={null}
      onValueChange={(item) => {
        if (item) onSelect(item.value);
      }}
    >
      {compact ? (
        <ComboboxTrigger render={<CompactSidebarButton label="More projects" />}>
          <EllipsisIcon />
        </ComboboxTrigger>
      ) : (
        <ComboboxTrigger render={<SidebarMenuButton />}>
          <EllipsisIcon />
          <span className="flex-1 truncate">More</span>
        </ComboboxTrigger>
      )}
      <ComboboxPopup
        side={compact ? "right" : "bottom"}
        className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
      >
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects..."
          value={menuState.query}
          onChange={(event) => dispatchMenu({ type: "query-changed", query: event.target.value })}
        />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: ProjectItem) => {
            const project = projectByKey.get(item.value);
            return (
              <ComboboxItem
                key={item.value}
                hideIndicator
                value={item}
                onContextMenu={(event) => {
                  if (!project) return;
                  event.preventDefault();
                  dispatchMenu({ type: "project-settings-opened" });
                  onOpenProjectSettings(project);
                }}
              >
                {project ? <ProjectFavicon project={project} className="size-4 shrink-0" /> : null}
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
