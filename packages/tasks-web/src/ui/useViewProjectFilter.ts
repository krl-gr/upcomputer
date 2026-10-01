import { useMemo } from "react";

import { useSidebarProjectFilter } from "../../../../apps/web/src/extensionApi.ts";
import type { ViewProjectFilter } from "./projectFilter.ts";

/**
 * The sidebar's selected project filter with an identity that only changes when
 * the selection or its member projects change (the host recomputes the object
 * whenever any project snapshot changes, which would otherwise restart queries).
 */
export function useViewProjectFilter(): ViewProjectFilter | null {
  const filter = useSidebarProjectFilter();
  const signature = filter
    ? JSON.stringify([
        filter.key,
        filter.label,
        filter.projectRefs.map((ref) => [ref.environmentId, ref.projectId]),
      ])
    : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
  return useMemo(() => filter, [signature]);
}
