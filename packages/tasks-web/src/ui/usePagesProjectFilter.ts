import { useMemo } from "react";

import type { ViewProjectFilter } from "./projectFilter.ts";
import { usePagesProjectKey } from "./pageFilters.ts";
import { useSidebarProjectSnapshots } from "./useWorkspaceData.ts";

/**
 * The project chosen in the Tasks, Agents and Automations headers, shared by
 * the three pages and kept across visits. It neither reads nor sets the
 * sidebar's project scope. The filter's identity only changes when the choice
 * or its member projects change (the snapshots are recomputed whenever any
 * project changes, which would otherwise restart queries).
 */
export function usePagesProjectFilter() {
  const [projectKey, setProjectKey] = usePagesProjectKey();
  const projectGroups = useSidebarProjectSnapshots();
  const snapshot =
    projectKey === null ? undefined : projectGroups.find((item) => item.projectKey === projectKey);
  const signature = snapshot
    ? JSON.stringify([
        snapshot.projectKey,
        snapshot.displayName,
        snapshot.memberProjectRefs.map((ref) => [ref.environmentId, ref.projectId]),
      ])
    : null;
  const projectFilter = useMemo<ViewProjectFilter | null>(
    () =>
      snapshot
        ? {
            key: snapshot.projectKey,
            label: snapshot.displayName,
            projectRefs: snapshot.memberProjectRefs,
          }
        : null,
    // Keyed by value, not identity.
    [signature],
  );
  return { projectFilter, projectGroups, setProjectKey };
}
