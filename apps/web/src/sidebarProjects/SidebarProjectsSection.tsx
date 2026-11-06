import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDndMonitor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CopyIcon, EllipsisIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useReducer, useRef, type ReactNode } from "react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import {
  filterSidebarProjectScopeItems,
  reduceSidebarProjectScopeMenuState,
} from "../components/Sidebar.logic";
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
import { cn } from "../lib/utils";
import {
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../sidebarMetrics/sidebarMetrics";
import { SidebarCompactTooltip } from "../adaptiveSidebar/adaptiveSidebar";
import { SidebarEmptyRow } from "./SidebarEmptyRow";
import { SidebarProjectRow } from "./SidebarProjectRow";
import { SidebarSectionHeader, SidebarSectionHeaderAction } from "./SidebarSectionHeader";
import { AllProjectsIcon, NoProjectIcon, ProjectRowIcon } from "./sidebarProjectIcons";
import { useSidebarProjectsList, type SidebarProjectsListRow } from "./useSidebarProjectsList";
import { errorToastDescription } from "~/components/errors/ErrorDetails";

export const SIDEBAR_PROJECTS_OPEN_STORAGE_KEY = "upcomputer:sidebar-projects-open";

function sidebarProjectsRowLabel(row: SidebarProjectsListRow): string {
  if (row.kind === "all") return "All projects";
  return row.kind === "scratch" ? "No project" : row.project.displayName;
}

interface ProjectItem {
  readonly value: string;
  readonly label: string;
}

/**
 * The sidebar's Projects section (UpComputer surface `sidebarProjects`). Every row
 * sets upstream's project scope, so the thread list filters as the header's scope
 * menu does; the header hides that menu while this surface is on.
 */
export function SidebarProjectsSection(props: {
  /** The sidebar's project groups, in its project sort order. */
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  /** Upstream's add project action, which the search row runs without this surface. */
  readonly onAddProject: () => void;
  /** False while the sidebar waits for its data, so no projects is not yet known. */
  readonly loaded: boolean;
}) {
  const { projectGroups, onAddProject, loaded } = props;
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleNewThread = useNewThreadHandler();
  const [open, setOpen] = useLocalStorage(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, true, Schema.Boolean);
  const { rows, selectedKey, select, holdSurface, sortable, moveRow } =
    useSidebarProjectsList(projectGroups);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null) return;
    moveRow(String(event.active.id), String(event.over.id));
  };

  const renderRow = (row: SidebarProjectsListRow) => {
    const isActive = selectedKey === row.key;
    if (row.kind === "all") {
      return (
        <SidebarCompactTooltip label="All projects">
          <SidebarMenuButton isActive={isActive} onClick={() => select(row.key)}>
            <AllProjectsIcon />
            <span className="flex-1 truncate">All projects</span>
          </SidebarMenuButton>
        </SidebarCompactTooltip>
      );
    }
    const { project } = row;
    if (row.kind === "scratch") {
      return (
        <SidebarProjectRow
          label="No project"
          icon={<NoProjectIcon />}
          isActive={isActive}
          onSelect={() => select(row.key)}
          newChatLabel="New chat without a project"
          onNewChat={() => startNewThread(project)}
        />
      );
    }
    return (
      <SidebarProjectRow
        label={project.displayName}
        icon={<ProjectRowIcon project={project} />}
        isActive={isActive}
        onSelect={() => select(row.key)}
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
    );
  };

  return (
    <Collapsible open={open}>
      <div className={SIDEBAR_SECTION_GAP} ref={holdSurface}>
        <SidebarSectionHeader
          title="Projects"
          open={open}
          onToggle={() => setOpen(!open)}
          testId="sidebar-projects-toggle"
          action={
            <SidebarSectionHeaderAction
              label="Add project"
              track="sidebar.add_project"
              onClick={onAddProject}
            >
              <PlusIcon />
            </SidebarSectionHeaderAction>
          }
        />
      </div>
      {!loaded ? null : (
        <CollapsiblePanel>
          <div className={cn(SIDEBAR_SECTION_HEADER_GAP, SIDEBAR_MENU_SCOPE)}>
            <SidebarMenu>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={rows.preview.map((row) => row.key)}
                  strategy={verticalListSortingStrategy}
                  disabled={!sortable}
                >
                  {rows.preview.map((row) => (
                    <SortableProjectsItem key={row.key} id={row.key}>
                      {renderRow(row)}
                    </SortableProjectsItem>
                  ))}
                </SortableContext>
              </DndContext>
              {rows.overflow.length > 0 ? (
                <SidebarMenuItem>
                  <SidebarProjectsMore
                    rows={rows.overflow}
                    onSelect={select}
                    onOpenProjectSettings={openProjectSettings}
                  />
                </SidebarMenuItem>
              ) : null}
              {projectGroups.length === 0 ? (
                <SidebarEmptyRow label="Add project" onClick={onAddProject} />
              ) : null}
            </SidebarMenu>
          </div>
        </CollapsiblePanel>
      )}
    </Collapsible>
  );
}

/** A Projects row that the manual project order lets the pointer drag. */
function SortableProjectsItem(props: { readonly id: string; readonly children: ReactNode }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  // A drop ends with a click on the dropped row, which must not select it.
  const draggedRef = useRef(false);
  useDndMonitor({
    onDragStart: (event) => {
      if (event.active.id === props.id) draggedRef.current = true;
    },
  });
  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "z-10")}
      onPointerDownCapture={() => {
        draggedRef.current = false;
      }}
      onClickCapture={(event) => {
        if (draggedRef.current) event.stopPropagation();
      }}
      {...listeners}
    >
      {props.children}
    </SidebarMenuItem>
  );
}

/**
 * "More": upstream's scope menu shape (search, then rows) over the remaining
 * rows, All projects and No project among them. As in upstream's menu,
 * right-click opens a project's settings.
 */
function SidebarProjectsMore(props: {
  readonly rows: ReadonlyArray<SidebarProjectsListRow>;
  /** A row key: a project key, or `ALL_PROJECTS_ROW_KEY`. */
  readonly onSelect: (key: string) => void;
  readonly onOpenProjectSettings: (project: SidebarProjectSnapshot) => void;
}) {
  const { rows, onSelect, onOpenProjectSettings } = props;
  const [menuState, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const items = rows.map((row) => ({ value: row.key, label: sidebarProjectsRowLabel(row) }));
  const rowByKey = new Map(rows.map((row) => [row.key, row] as const));
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
      <SidebarCompactTooltip label="More projects">
        <ComboboxTrigger render={<SidebarMenuButton />}>
          <EllipsisIcon />
          <span className="flex-1 truncate">More</span>
        </ComboboxTrigger>
      </SidebarCompactTooltip>
      <ComboboxPopup
        side="bottom"
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
            const row = rowByKey.get(item.value);
            const project = row?.kind === "project" ? row.project : null;
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
                {row?.kind === "all" ? (
                  <AllProjectsIcon className="size-4 shrink-0" />
                ) : row?.kind === "scratch" ? (
                  <NoProjectIcon className="size-4" />
                ) : project ? (
                  <ProjectFavicon project={project} className="size-4 shrink-0" />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
