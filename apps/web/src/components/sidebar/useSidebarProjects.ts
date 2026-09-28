import { useMemo } from "react";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { useIsScratchProject } from "../../hooks/useScratchProject";
import { useClientSettings } from "../../hooks/useSettings";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../../uiStateStore";
import { orderItemsByPreferredIds } from "../Sidebar.logic";
import {
  resolveSidebarProjectFilter,
  type SidebarProjectFilter,
} from "./sidebarProjectFilter.logic";

export type { SidebarProjectFilter } from "./sidebarProjectFilter.logic";

/**
 * Logical (grouped) projects the sidebar lists, in the user's stored project
 * order, without the hidden "No project" scratch projects.
 */
export function useSidebarLogicalProjects(): readonly SidebarProjectSnapshot[] {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isScratchProject = useIsScratchProject();
  const { environments } = useEnvironments();

  return useMemo(() => {
    const environmentLabelById = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    const desktopLocalEnvironmentIds = new Set(
      environments
        .filter((environment) => isDesktopLocalConnectionTarget(environment.entry.target))
        .map((environment) => environment.environmentId),
    );
    const orderedProjects = orderItemsByPreferredIds({
      items: projects.filter((project) => !isScratchProject(project)),
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
    return buildSidebarProjectSnapshots({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      isDesktopLocalEnvironment: (environmentId) => desktopLocalEnvironmentIds.has(environmentId),
    });
  }, [
    environments,
    isScratchProject,
    primaryEnvironmentId,
    projectGroupingSettings,
    projectOrder,
    projects,
  ]);
}

/**
 * The project the sidebar's chat list is filtered to, or null for "All
 * projects" (also when the stored selection no longer resolves). Exported to
 * product extensions so their views can follow the same selection.
 */
export function useSidebarProjectFilter(): SidebarProjectFilter | null {
  const filterKey = useUiStateStore((store) => store.sidebarProjectFilterKey);
  const logicalProjects = useSidebarLogicalProjects();
  return useMemo(
    () => resolveSidebarProjectFilter(filterKey, logicalProjects),
    [filterKey, logicalProjects],
  );
}
