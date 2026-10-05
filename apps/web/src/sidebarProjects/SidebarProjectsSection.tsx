import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { EllipsisIcon, LayoutGridIcon, MessageSquareDashedIcon } from "lucide-react";
import { useCallback, useMemo, useReducer, type MouseEvent as ReactMouseEvent } from "react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import {
  filterSidebarProjectScopeItems,
  reduceSidebarProjectScopeMenuState,
} from "../components/Sidebar.logic";
import { Collapsible, CollapsiblePanel } from "../components/ui/collapsible";
import { CollapsibleSectionHeader } from "../components/ui/collapsible-section-header";
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
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { readLocalApi } from "../localApi";
import { projectIconColorClassName } from "../projectIconColors";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { useServerConfigs } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { buildSidebarProjectsRows } from "./sidebarProjects.logic";

export const SIDEBAR_PROJECTS_OPEN_STORAGE_KEY = "upcomputer:sidebar-projects-open";

type ProjectMenuAction = "new-thread" | "project-settings";

interface ProjectItem {
  readonly value: string;
  readonly label: string;
}

/**
 * The sidebar's Projects section (UpComputer surface `sidebarProjects`): All
 * projects, the first projects in the sidebar's project order, No project and
 * More. Every row sets upstream's project scope, so the thread list filters
 * exactly as the header's scope menu does; the header hides that menu while
 * this surface is on.
 */
export function SidebarProjectsSection(props: {
  /** The sidebar's project groups, in its project sort order. */
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
}) {
  const { projectGroups } = props;
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleNewThread = useNewThreadHandler();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const scopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const [open, setOpen] = useLocalStorage(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, true, Schema.Boolean);

  const rows = useMemo(
    () =>
      buildSidebarProjectsRows({
        projects: projectGroups,
        selectedProjectKey: scopeKey,
        isScratch: (group) =>
          group.memberProjects.some((member) =>
            isScratchProject(member, serverConfigs.get(member.environmentId)?.scratchWorkspaceRoot),
          ),
        isPrimary: (group) =>
          group.memberProjects.some((member) => member.environmentId === primaryEnvironmentId),
      }),
    [primaryEnvironmentId, projectGroups, scopeKey, serverConfigs],
  );
  const selectedProject = useMemo(
    () => projectGroups.find((group) => group.projectKey === scopeKey) ?? null,
    [projectGroups, scopeKey],
  );

  const openProjectSettings = useCallback(
    (project: SidebarProjectSnapshot) => {
      if (isMobile) setOpenMobile(false);
      void router.navigate({
        to: "/projects/$projectKey",
        params: { projectKey: project.projectKey },
      });
    },
    [isMobile, router, setOpenMobile],
  );
  const showProjectMenu = useCallback(
    async (project: SidebarProjectSnapshot, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await settlePromise(() =>
        api.contextMenu.show<ProjectMenuAction>(
          [
            { id: "new-thread", label: "New thread" },
            { id: "project-settings", label: "Project settings" },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value === "new-thread") {
        if (isMobile) setOpenMobile(false);
        void handleNewThread(scopeProjectRef(project.environmentId, project.id));
      } else if (clicked.value === "project-settings") {
        openProjectSettings(project);
      }
    },
    [handleNewThread, isMobile, openProjectSettings, setOpenMobile],
  );
  const onProjectContextMenu = useCallback(
    (event: ReactMouseEvent, project: SidebarProjectSnapshot) => {
      event.preventDefault();
      void showProjectMenu(project, { x: event.clientX, y: event.clientY });
    },
    [showProjectMenu],
  );

  if (projectGroups.length === 0) return null;

  return (
    <Collapsible open={open}>
      <div className="pt-2">
        <CollapsibleSectionHeader
          expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="sidebar-projects-toggle"
          accessory={
            // Collapsed, the header still names an active filter.
            !open && selectedProject ? (
              <span className="flex min-w-0 max-w-[50%] items-center gap-1.5">
                {selectedProject === rows.scratch ? null : (
                  <ProjectFavicon project={selectedProject} className="size-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {selectedProject === rows.scratch ? "No project" : selectedProject.displayName}
                </span>
              </span>
            ) : null
          }
        >
          Projects
        </CollapsibleSectionHeader>
      </div>
      <CollapsiblePanel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={scopeKey === null} onClick={() => setScopeKey(null)}>
              <LayoutGridIcon />
              <span className="flex-1 truncate">All projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {rows.preview.map((project) => (
            <SidebarMenuItem key={project.projectKey}>
              <SidebarMenuButton
                isActive={scopeKey === project.projectKey}
                onClick={() => setScopeKey(project.projectKey)}
                onContextMenu={(event) => onProjectContextMenu(event, project)}
              >
                {/* Wrapped so the button's svg color rule leaves the project's own icon color. */}
                <span className="flex shrink-0">
                  <ProjectFavicon project={project} className="size-4" />
                </span>
                <span className="flex-1 truncate">{project.displayName}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {rows.scratch ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={scopeKey === rows.scratch.projectKey}
                onClick={() => setScopeKey(rows.scratch?.projectKey ?? null)}
              >
                <span className={`flex size-4 shrink-0 ${projectIconColorClassName("gray")}`}>
                  <MessageSquareDashedIcon className="size-full" />
                </span>
                <span className="flex-1 truncate">No project</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {rows.overflow.length > 0 ? (
            <SidebarMenuItem>
              <SidebarProjectsMore
                projects={rows.overflow}
                onSelect={setScopeKey}
                onProjectContextMenu={onProjectContextMenu}
              />
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** "More": upstream's scope menu shape (search, then projects) over the remaining projects. */
function SidebarProjectsMore(props: {
  readonly projects: ReadonlyArray<SidebarProjectSnapshot>;
  readonly onSelect: (projectKey: string) => void;
  readonly onProjectContextMenu: (event: ReactMouseEvent, project: SidebarProjectSnapshot) => void;
}) {
  const { projects, onSelect, onProjectContextMenu } = props;
  const [menuState, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const items = useMemo(
    (): ProjectItem[] =>
      projects.map((project) => ({ value: project.projectKey, label: project.displayName })),
    [projects],
  );
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [project.projectKey, project] as const)),
    [projects],
  );
  const filteredItems = useMemo(
    () =>
      filterSidebarProjectScopeItems({
        items,
        query: menuState.query,
        matches: (item, query) => filter.contains(item, query, (candidate) => candidate.label),
      }),
    [filter, items, menuState.query],
  );
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
      <ComboboxTrigger render={<SidebarMenuButton />}>
        <EllipsisIcon />
        <span className="flex-1 truncate">More</span>
      </ComboboxTrigger>
      <ComboboxPopup className="max-w-[min(18rem,var(--available-width))] overflow-hidden">
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
                  dispatchMenu({ type: "project-settings-opened" });
                  onProjectContextMenu(event, project);
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
