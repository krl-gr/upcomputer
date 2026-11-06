import * as Schema from "effect/Schema";
import { useState } from "react";

import { sortSidebarV2ProjectGroups } from "../components/Sidebar.logic";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useClientSettings } from "../hooks/useSettings";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { useDelegatedUnderParent, useQuietThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { useIsPrimaryProjectGroup, useIsScratchProjectGroup } from "./sidebarProjectIcons";
import {
  ALL_PROJECTS_ROW_KEY,
  allProjectsSortIndex,
  buildSidebarProjectsRows,
  manualAllProjectsIndex,
  sidebarProjectsDragOrder,
  type SidebarProjectsRow,
} from "./sidebarProjects.logic";

export const SIDEBAR_ALL_PROJECTS_SELECTED_AT_STORAGE_KEY =
  "upcomputer:sidebar-all-projects-selected-at";

const PICKED_AT_SCHEMA = Schema.NullOr(Schema.String);

// Before All projects is picked it is the fresh install's selection, so it comes first.
const NEVER_PICKED = "9999-12-31T23:59:59.999Z";

/** The sidebar elements a pointer stays in while the Projects rows hold still. */
const SIDEBAR_SURFACES = "[data-sidebar='sidebar']";

export type SidebarProjectsListRow = SidebarProjectsRow<SidebarProjectSnapshot>;

/** A row's keys in the manual project order: All projects' own, or its project's members'. */
function rowOrderKeys(row: SidebarProjectsListRow): ReadonlyArray<string> {
  return row.kind === "all"
    ? [ALL_PROJECTS_ROW_KEY]
    : row.project.memberProjects.map((member) => member.physicalProjectKey);
}

function sameKeys(left: ReadonlyArray<string> | null, right: ReadonlyArray<string>) {
  return left?.length === right.length && left.every((key, index) => key === right[index]);
}

/**
 * The Projects section's rows, for the sidebar and its icon column: All
 * projects, No project and the projects in one order, which holds still while
 * the pointer is in the sidebar. Pass `holdSurface` as the ref of an element inside it.
 */
export function useSidebarProjectsList(projectGroups: ReadonlyArray<SidebarProjectSnapshot>) {
  // Our Projects section scopes to one project; upstream's scope can hold several.
  const scopeKey = useUiStateStore((store) => store.sidebarProjectScopeKeys[0] ?? null);
  const setScopeKeys = useUiStateStore((store) => store.setSidebarProjectScopeKeys);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const sortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const isScratch = useIsScratchProjectGroup();
  const isPrimary = useIsPrimaryProjectGroup();
  const [allProjectsPickedAt, setAllProjectsPickedAt] = useLocalStorage(
    SIDEBAR_ALL_PROJECTS_SELECTED_AT_STORAGE_KEY,
    null,
    PICKED_AT_SCHEMA,
  );
  const [pointerInside, setPointerInside] = useState(false);
  const [heldOrder, setHeldOrder] = useState<ReadonlyArray<string> | null>(null);

  const allProjectsIndex =
    sortOrder === "manual"
      ? manualAllProjectsIndex({
          projectOrder,
          projectOrderKeys: projectGroups.map((group) =>
            group.memberProjects.map((member) => member.physicalProjectKey),
          ),
        })
      : allProjectsSortIndex(
          sortSidebarV2ProjectGroups(
            [
              ...projectGroups,
              {
                id: ALL_PROJECTS_ROW_KEY,
                title: "All projects",
                projectKey: ALL_PROJECTS_ROW_KEY,
                memberProjectRefs: [],
                createdAt: allProjectsPickedAt ?? NEVER_PICKED,
                updatedAt: allProjectsPickedAt ?? NEVER_PICKED,
              },
            ],
            threads,
            sortOrder,
            delegatedUnderParent,
          ),
        );
  const selectedKey = scopeKey ?? ALL_PROJECTS_ROW_KEY;
  const rows = buildSidebarProjectsRows({
    projects: projectGroups,
    allProjectsIndex,
    selectedKey,
    isScratch,
    isPrimary,
    heldOrder: pointerInside ? heldOrder : null,
  });
  const shownRows = [...rows.preview, ...rows.overflow];
  const shownKeys = shownRows.map((row) => row.key);
  // While the pointer is in, the order on screen is the one the next render starts from.
  if (pointerInside && !sameKeys(heldOrder, shownKeys)) setHeldOrder(shownKeys);
  if (!pointerInside && heldOrder !== null) setHeldOrder(null);

  const holdSurface = (element: HTMLElement | null) => {
    const surface = element?.closest<HTMLElement>(SIDEBAR_SURFACES);
    if (!surface) return;
    const enter = () => setPointerInside(true);
    const leave = () => setPointerInside(false);
    surface.addEventListener("pointerenter", enter);
    surface.addEventListener("pointerleave", leave);
    // A remount under the pointer gets no pointerenter.
    if (surface.matches(":hover")) setPointerInside(true);
    return () => {
      surface.removeEventListener("pointerenter", enter);
      surface.removeEventListener("pointerleave", leave);
    };
  };

  const select = (key: string) => {
    // Until All projects is picked, it counts as picked up to the first other pick.
    if (key === ALL_PROJECTS_ROW_KEY || allProjectsPickedAt === null) {
      setAllProjectsPickedAt(new Date().toISOString());
    }
    setScopeKeys(key === ALL_PROJECTS_ROW_KEY ? [] : [key]);
  };

  /** Drops the row `activeKey` on `overKey`'s place in the manual order. */
  const moveRow = (activeKey: string, overKey: string) => {
    const active = shownRows.find((row) => row.key === activeKey);
    const over = shownRows.find((row) => row.key === overKey);
    if (!active || !over || active === over) return;
    reorderProjects(
      sidebarProjectsDragOrder({ rowOrderKeys: shownRows.map(rowOrderKeys), projectOrder }),
      rowOrderKeys(active),
      rowOrderKeys(over),
    );
    // The dropped row stays where the pointer left it.
    const keys = shownKeys.filter((key) => key !== activeKey);
    const overIndex = shownRows.indexOf(over);
    keys.splice(overIndex, 0, activeKey);
    setHeldOrder(keys);
  };

  return {
    rows,
    selectedKey,
    select,
    holdSurface,
    sortable: sortOrder === "manual",
    moveRow,
  };
}
