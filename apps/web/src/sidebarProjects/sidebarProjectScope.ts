import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";

import { useClientSettings } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { productSurface } from "../product/productFlags";
import { useUiStateStore } from "../uiStateStore";
import {
  buildSidebarProjectSnapshots,
  resolveSidebarProjectScopeKeys,
} from "../sidebarProjectGrouping";

type ProjectScopeInput = {
  readonly keys: ReadonlyArray<string>;
  readonly projects: ReturnType<typeof useProjects>;
  readonly settings: ReturnType<typeof selectProjectGroupingSettings>;
  readonly primaryEnvironmentId: ReturnType<typeof usePrimaryEnvironmentId>;
};

// Every thread row asks for the scope, so one resolution serves them until an input changes.
let lastScope: {
  readonly input: ProjectScopeInput;
  readonly scope: ReadonlyArray<ScopedProjectRef> | null;
} | null = null;

function sameScopeInput(left: ProjectScopeInput, right: ProjectScopeInput) {
  return (
    left.keys === right.keys &&
    left.projects === right.projects &&
    left.primaryEnvironmentId === right.primaryEnvironmentId &&
    left.settings.sidebarProjectGroupingMode === right.settings.sidebarProjectGroupingMode &&
    left.settings.sidebarProjectGroupingOverrides === right.settings.sidebarProjectGroupingOverrides
  );
}

function resolveProjectScope(input: ProjectScopeInput): ReadonlyArray<ScopedProjectRef> | null {
  if (input.keys.length === 0) return null;
  if (lastScope !== null && sameScopeInput(lastScope.input, input)) return lastScope.scope;
  const groups = buildSidebarProjectSnapshots({
    projects: input.projects,
    settings: input.settings,
    groupScratchProjects: true,
    primaryEnvironmentId: input.primaryEnvironmentId,
    resolveEnvironmentLabel: () => null,
  });
  const scoped = resolveSidebarProjectScopeKeys({
    groups,
    keys: input.keys,
    settings: input.settings,
  });
  const chosen = groups.filter((group) => scoped.includes(group.projectKey));
  const scope = chosen.length === 0 ? null : chosen.flatMap((group) => group.memberProjectRefs);
  lastScope = { input, scope };
  return scope;
}

/**
 * The projects the sidebar's Projects filter selected, for sections that follow it (Bots): null for All
 * projects, which a key of no listed project also reads as; No project selects the Scratch projects.
 * Keys resolve to groups as the Threads list resolves them.
 */
export function useSidebarProjectScope(): ReadonlyArray<ScopedProjectRef> | null {
  const keys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return resolveProjectScope({ keys, projects, settings, primaryEnvironmentId });
}

/**
 * Selects a project just added, as the main view opens its new thread. Its group
 * key is only known once the project is listed, so the scope holds its ref, which
 * `resolveSidebarProjectScopeKey` resolves to the group.
 */
export function selectAddedProjectInSidebar(projectRef: ScopedProjectRef): void {
  if (productSurface("sidebarProjects") !== "upcomputer") return;
  useUiStateStore.getState().setSidebarProjectScopeKeys([scopedProjectKey(projectRef)]);
}
