import { useMemo } from "react";

import { useUiStateStore } from "../../../../apps/web/src/uiStateStore.ts";
import type { ViewProjectFilter } from "./projectFilter.ts";
import { useSidebarProjectSnapshots } from "./useWorkspaceData.ts";

/**
 * The sidebar's selected project scope with an identity that only changes when
 * the selection or its member projects change (the snapshots are recomputed
 * whenever any project changes, which would otherwise restart queries).
 */
export function useViewProjectFilter(): ViewProjectFilter | null {
  const scopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const snapshots = useSidebarProjectSnapshots();
  const snapshot =
    scopeKey === null ? undefined : snapshots.find((item) => item.projectKey === scopeKey);
  const signature = snapshot
    ? JSON.stringify([
        snapshot.projectKey,
        snapshot.displayName,
        snapshot.memberProjectRefs.map((ref) => [ref.environmentId, ref.projectId]),
      ])
    : null;
  return useMemo<ViewProjectFilter | null>(
    () =>
      snapshot
        ? {
            key: snapshot.projectKey,
            label: snapshot.displayName,
            projectRefs: snapshot.memberProjectRefs,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
    [signature],
  );
}
