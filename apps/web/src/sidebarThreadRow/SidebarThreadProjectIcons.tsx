import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { memo, useMemo } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { NoProjectIcon, ProjectRowIcon } from "../sidebarProjects/sidebarProjectIcons";
import { useProjects, useServerConfigs } from "../state/entities";
import type { SidebarThreadSummary } from "../types";
import { useUiStateStore } from "../uiStateStore";
import { resolveThreadProjectIconStack } from "./threadProjectIcons.logic";

// One project index for every row, rebuilt only when the project list changes.
const projectIndexes = new WeakMap<
  ReadonlyArray<EnvironmentProject>,
  ReadonlyMap<string, EnvironmentProject>
>();
function projectIndex(projects: ReadonlyArray<EnvironmentProject>) {
  let index = projectIndexes.get(projects);
  if (!index) {
    index = new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project]));
    projectIndexes.set(projects, index);
  }
  return index;
}

/**
 * A thread row's leading project icons, as V1's: its own project, then the
 * projects it links, up to three with every name in the tooltip. A chat
 * without a project shows its linked projects, or V1's muted chat icon while
 * it has none. The links come from the thread shell the sidebar already
 * holds, so agents linking or unlinking a project update the row live. A
 * project-scoped list hides the icons, as V1's filtered list did.
 */
export const SidebarThreadProjectIcons = memo(function SidebarThreadProjectIcons(props: {
  readonly thread: Pick<SidebarThreadSummary, "environmentId" | "linkedProjectIds">;
  readonly project: EnvironmentProject | null;
}) {
  const { environmentId, linkedProjectIds } = props.thread;
  const ownProject = props.project;
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const isProjectScoped = useUiStateStore((state) => state.sidebarProjectScopeKey != null);
  const stack = useMemo(() => {
    const index = projectIndex(projects);
    const scratchRoot = serverConfigs.get(environmentId)?.scratchWorkspaceRoot;
    return resolveThreadProjectIconStack({
      thread: { environmentId, linkedProjectIds },
      ownProject,
      projectById: (projectId) => index.get(`${environmentId}:${projectId}`),
      isScratchProject: (project) => isScratchProject(project, scratchRoot),
    });
  }, [environmentId, linkedProjectIds, ownProject, projects, serverConfigs]);

  if (isProjectScoped) return null;
  if (stack.showScratchIcon) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span role="img" aria-label="No project" className="flex shrink-0" />}
        >
          <NoProjectIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">No project</TooltipPopup>
      </Tooltip>
    );
  }
  if (stack.visibleProjects.length === 0) return null;
  const projectNames = stack.allProjects.map((project) => project.title).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={projectNames}
            className="flex shrink-0 items-center gap-0.5"
          />
        }
      >
        {stack.visibleProjects.map((project) => (
          <ProjectRowIcon key={project.id} project={project} />
        ))}
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-80 whitespace-normal">
        {projectNames}
      </TooltipPopup>
    </Tooltip>
  );
});
