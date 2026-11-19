import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { sortThreads } from "@t3tools/client-runtime/state/thread-sort";
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
import { type AnyRouter, useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { CopyIcon, EllipsisIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useReducer, useRef, type ReactNode } from "react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import {
  filterSidebarProjectScopeItems,
  isSidebarHiddenThread,
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
import { useComposerDraftStore } from "../composerDraftStore";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useClientSettings } from "../hooks/useSettings";
import { projectLinksByKey, type LinkedProjectScopeThread } from "../linkedProjects/projectScope";
import { claimedSidebarThreadKeys } from "../product/sidebarThreadClaims";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { readNavigationThreadShells, readProjects, readThreadShell } from "../state/entities";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
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
import {
  AllProjectsIcon,
  NoProjectIcon,
  ProjectRowIcon,
  useIsScratchProjectGroup,
} from "./sidebarProjectIcons";
import { resolveSidebarProjectPick } from "./sidebarProjects.logic";
import { useSidebarProjectsList, type SidebarProjectsListRow } from "./useSidebarProjectsList";
import { errorToastDescription } from "~/components/errors/ErrorDetails";

export const SIDEBAR_PROJECTS_OPEN_STORAGE_KEY = "upcomputer:sidebar-projects-open";

function sidebarProjectsRowLabel(
  row: SidebarProjectsListRow,
  gt: ReturnType<typeof useGT>,
): string {
  if (row.kind === "all") return gt("All projects");
  return row.kind === "scratch" ? gt("No project") : row.project.displayName;
}

/** The open thread, or the open draft's project, from the route. */
function readOpenChat(router: AnyRouter): LinkedProjectScopeThread | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  if (target === null) return null;
  const drafts = useComposerDraftStore.getState();
  if (target.kind === "server") {
    return readThreadShell(target.threadRef) ?? drafts.getDraftThread(target.threadRef);
  }
  const draft = drafts.getDraftSession(target.draftId);
  return (draft?.promotedTo ? readThreadShell(draft.promotedTo) : null) ?? draft;
}

/** The threads the Threads list can show: no side chats, subagents or bot chats. */
function readListedThreads() {
  const claimed = claimedSidebarThreadKeys();
  return readNavigationThreadShells().filter(
    (thread) =>
      !isSidebarHiddenThread(thread) &&
      !claimed.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
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
  const gt = useGT();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleNewThread = useNewThreadHandler();
  const isScratchGroup = useIsScratchProjectGroup();
  const threadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const [open, setOpen] = useLocalStorage(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, true, Schema.Boolean);
  const {
    projectGroups: listedGroups,
    rows,
    selectedKey,
    select,
    holdSurface,
    sortable,
    moveRow,
  } = useSidebarProjectsList(projectGroups);
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
      toastManager.add({ type: "success", title: gt("Path copied"), description: path });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to copy path"),
          description: errorToastDescription(error),
        }),
      );
    },
  });
  /** Filters to the row's project and moves an open chat of another project there. */
  const pick = (key: string) => {
    select(key);
    const row = [...rows.preview, ...rows.overflow].find((candidate) => candidate.key === key);
    if (row === undefined || row.kind === "all") return;
    const { project } = row;
    const destination = resolveSidebarProjectPick({
      openChat: readOpenChat(router),
      projectKeys: new Set(
        project.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
      ),
      projectLinks: projectLinksByKey(readProjects()),
      threads: sortThreads(readListedThreads(), threadSortOrder),
    });
    if (destination.kind === "thread") {
      const { thread } = destination;
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    } else if (destination.kind === "new-chat") {
      void handleNewThread(scopeProjectRef(project.environmentId, project.id));
    }
  };
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null) return;
    moveRow(String(event.active.id), String(event.over.id));
  };

  const renderRow = (row: SidebarProjectsListRow) => {
    const isActive = selectedKey === row.key;
    if (row.kind === "all") {
      return (
        <SidebarCompactTooltip label={gt("All projects")}>
          <SidebarMenuButton isActive={isActive} onClick={() => pick(row.key)}>
            <AllProjectsIcon />
            <span className="flex-1 truncate">
              <T>All projects</T>
            </span>
          </SidebarMenuButton>
        </SidebarCompactTooltip>
      );
    }
    const { project } = row;
    if (row.kind === "scratch") {
      return (
        <SidebarProjectRow
          label={gt("No project")}
          icon={<NoProjectIcon />}
          isActive={isActive}
          onSelect={() => pick(row.key)}
          newChatLabel={gt("New chat without a project")}
          onNewChat={() => startNewThread(project)}
        />
      );
    }
    return (
      <SidebarProjectRow
        label={project.displayName}
        icon={<ProjectRowIcon project={project} />}
        isActive={isActive}
        onSelect={() => pick(row.key)}
        newChatLabel={gt("New chat in {project}", { project: project.displayName })}
        onNewChat={() => startNewThread(project)}
        menuLabel={gt("Project actions for {project}", { project: project.displayName })}
        menuItems={
          <>
            <MenuItem onClick={() => openProjectSettings(project)}>
              <SettingsIcon />
              <T>Project settings</T>
            </MenuItem>
            <MenuItem
              onClick={() =>
                copyPathToClipboard(project.workspaceRoot, {
                  path: project.workspaceRoot,
                })
              }
            >
              <CopyIcon />
              <T>Copy path</T>
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
          title={gt("Projects")}
          open={open}
          onToggle={() => setOpen(!open)}
          testId="sidebar-projects-toggle"
          action={
            <SidebarSectionHeaderAction
              label={gt("Add project")}
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
                    onSelect={pick}
                    onOpenProjectSettings={openProjectSettings}
                  />
                </SidebarMenuItem>
              ) : null}
              {/* "No project" alone is still an empty list of projects. */}
              {listedGroups.every(isScratchGroup) ? (
                <SidebarEmptyRow label={gt("New project")} onClick={onAddProject} />
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
  const gt = useGT();
  const [menuState, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const items = rows.map((row) => ({ value: row.key, label: sidebarProjectsRowLabel(row, gt) }));
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
      <SidebarCompactTooltip label={gt("More projects")}>
        <ComboboxTrigger render={<SidebarMenuButton />}>
          <EllipsisIcon />
          <span className="flex-1 truncate">
            <T>More</T>
          </span>
        </ComboboxTrigger>
      </SidebarCompactTooltip>
      <ComboboxPopup
        side="bottom"
        className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
      >
        <ComboboxSearchInput
          aria-label={gt("Search projects")}
          placeholder={gt("Search projects...")}
          value={menuState.query}
          onChange={(event) => dispatchMenu({ type: "query-changed", query: event.target.value })}
        />
        <ComboboxEmpty>
          <T>No matching projects.</T>
        </ComboboxEmpty>
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
