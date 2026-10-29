import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import type { ScopedProjectRef } from "@t3tools/contracts";

import { useClientSettings } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import {
  buildSidebarProjectSnapshots,
  resolveSidebarProjectScopeKeys,
} from "../sidebarProjectGrouping";
import { useIsScratchProjectGroup } from "./sidebarProjectIcons";

/**
 * The projects the sidebar's Projects filter selected, for sections that follow it (Bots): null for All
 * projects, and none for No project. Keys resolve to groups as the Threads list resolves them.
 */
export function useSidebarProjectScope(): ReadonlyArray<ScopedProjectRef> | null {
  const keys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isScratch = useIsScratchProjectGroup();
  if (keys.length === 0) return null;
  const groups = buildSidebarProjectSnapshots({
    projects,
    settings,
    groupScratchProjects: true,
    primaryEnvironmentId,
    resolveEnvironmentLabel: () => null,
  });
  const scoped = resolveSidebarProjectScopeKeys({ groups, keys, settings });
  const chosen = groups.filter((group) => scoped.includes(group.projectKey));
  if (chosen.length === 0) return null;
  return chosen.flatMap((group) => (isScratch(group) ? [] : group.memberProjectRefs));
}
