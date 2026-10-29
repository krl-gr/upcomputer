import { isScratchProject } from "@t3tools/client-runtime/state/projects";

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
 * "All projects": four tiles like project monograms' backgrounds, in the
 * row's icon color. Sized by its container, like the sidebar button's own icons.
 */
export function AllProjectsIcon(props: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      fillOpacity={0.28}
      aria-hidden="true"
      data-icon="all-projects"
      className={props.className}
    >
      <rect x="1" y="1" width="6" height="6" rx="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </svg>
  );
}

/**
 * "No project", the primary environment's Scratch project: a project monogram's
 * tile (`ProjectMonogram`), empty and outlined with dashes.
 */
export function NoProjectIcon(props: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0",
        props.className ?? SIDEBAR_ICON_SIZE,
        projectIconColorClassName("gray"),
      )}
    >
      <svg viewBox="0 0 16 16" fill="none" data-icon="no-project" className="size-full">
        <rect
          x="0.5"
          y="0.5"
          width="15"
          height="15"
          rx="3.5"
          stroke="currentColor"
          strokeDasharray="2.5 1.75"
        />
      </svg>
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
  return buildSidebarProjectsRows({
    projects: projectGroups,
    selectedProjectKey,
    isScratch: (group) =>
      group.memberProjects.some((member) =>
        isScratchProject(member, serverConfigs.get(member.environmentId)?.scratchWorkspaceRoot),
      ),
    isPrimary: (group) =>
      group.memberProjects.some((member) => member.environmentId === primaryEnvironmentId),
    ...(limit === undefined ? {} : { limit }),
  });
}
