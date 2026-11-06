import { isScratchProject } from "@t3tools/client-runtime/state/projects";

import { ProjectFavicon, type ProjectFaviconProject } from "../components/ProjectFavicon";
import { cn } from "../lib/utils";
import { projectIconColorClassName } from "../projectIconColors";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { SIDEBAR_ICON_SIZE } from "../sidebarMetrics/sidebarMetrics";
import { useServerConfigs } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { primaryScratchProject } from "./sidebarProjects.logic";

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
      fillOpacity={0.14}
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
 * tile (`ProjectMonogram`) filled plain gray, without letters.
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
      <svg viewBox="0 0 16 16" data-icon="no-project" className="size-full">
        <rect width="16" height="16" rx="4" fill="currentColor" fillOpacity={0.14} />
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

/** Whether a project group is a Scratch project, the one "No project" stands for. */
export function useIsScratchProjectGroup() {
  const serverConfigs = useServerConfigs();
  return (group: Pick<SidebarProjectSnapshot, "memberProjects">) =>
    group.memberProjects.some((member) =>
      isScratchProject(member, serverConfigs.get(member.environmentId)?.scratchWorkspaceRoot),
    );
}

/** Whether a project group is in the primary environment. */
export function useIsPrimaryProjectGroup() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return (group: Pick<SidebarProjectSnapshot, "memberProjects">) =>
    group.memberProjects.some((member) => member.environmentId === primaryEnvironmentId);
}

/** The project group "No project" stands for, among the sidebar's project groups. */
export function useSidebarScratchProject(
  projectGroups: ReadonlyArray<SidebarProjectSnapshot>,
): SidebarProjectSnapshot | null {
  const isScratch = useIsScratchProjectGroup();
  const isPrimary = useIsPrimaryProjectGroup();
  return primaryScratchProject({ projects: projectGroups, isScratch, isPrimary });
}
