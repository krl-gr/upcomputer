import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { MessageSquareDashedIcon } from "lucide-react";
import { useMemo } from "react";

import { ProjectFavicon, type ProjectFaviconProject } from "../components/ProjectFavicon";
import { cn } from "../lib/utils";
import { projectIconColorClassName } from "../projectIconColors";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { SIDEBAR_ICON_SIZE } from "../sidebarMetrics/sidebarMetrics";
import { useServerConfigs } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { buildSidebarProjectsRows } from "./sidebarProjects.logic";

/*
 * Rows and icons of the sidebar's Projects section, shared with the project
 * select of the Tasks, Agents and Automations pages so both look the same.
 */

/**
 * "All projects": the site's four-tile mark, filling the same box as a
 * project's icon. Sized by its container, like the sidebar button's own icons.
 */
export function AllProjectsIcon(props: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      fillOpacity={0.45}
      aria-hidden="true"
      className={props.className}
    >
      <rect x="0" y="0" width="7" height="7" rx="1.5" />
      <rect x="9" y="0" width="7" height="7" rx="1.5" />
      <rect x="0" y="9" width="7" height="7" rx="1.5" />
      <rect x="9" y="9" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** "No project", the primary environment's Scratch project. */
export function NoProjectIcon() {
  return (
    <span className={cn("flex shrink-0", SIDEBAR_ICON_SIZE, projectIconColorClassName("gray"))}>
      <MessageSquareDashedIcon className="size-full" />
    </span>
  );
}

/** A project's favicon, icon or monogram, wrapped so a parent's svg color rule leaves its color. */
export function ProjectRowIcon(props: { readonly project: ProjectFaviconProject }) {
  return (
    <span className="flex shrink-0">
      <ProjectFavicon project={props.project} className={SIDEBAR_ICON_SIZE} />
    </span>
  );
}

/** The Projects section's rows for the sidebar's ordered project groups. */
export function useSidebarProjectsRows(
  projectGroups: ReadonlyArray<SidebarProjectSnapshot>,
  selectedProjectKey: string | null,
  limit?: number,
) {
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useMemo(
    () =>
      buildSidebarProjectsRows({
        projects: projectGroups,
        selectedProjectKey,
        isScratch: (group) =>
          group.memberProjects.some((member) =>
            isScratchProject(member, serverConfigs.get(member.environmentId)?.scratchWorkspaceRoot),
          ),
        isPrimary: (group) =>
          group.memberProjects.some((member) => member.environmentId === primaryEnvironmentId),
        ...(limit === undefined ? {} : { limit }),
      }),
    [limit, primaryEnvironmentId, projectGroups, selectedProjectKey, serverConfigs],
  );
}
