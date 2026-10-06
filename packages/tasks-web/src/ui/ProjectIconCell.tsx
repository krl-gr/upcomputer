import { FolderIcon } from "lucide-react";

import type { ProjectFaviconProject } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import {
  AllProjectsIcon,
  ProjectRowIcon,
} from "../../../../apps/web/src/sidebarProjects/sidebarProjectIcons.tsx";

/**
 * Header of the project icon column of the Tasks, Agents and Automations
 * tables. The column comes first (after a reorder handle) and is left out when
 * the header's project select is set to one project.
 */
export function ProjectIconHeader() {
  return (
    <th className="w-9 py-3 pr-3 font-medium">
      <span className="sr-only">Project</span>
    </th>
  );
}

/**
 * A row's project as an icon only, with the full name in a tooltip. Items that
 * apply to every project (global agents) show the sidebar's All projects icon.
 */
export function ProjectIconCell(props: {
  /** The project record, or null when it is not loaded. */
  readonly project: ProjectFaviconProject | null;
  readonly name: string | null;
  /** The item has no project and applies to all of them. */
  readonly allProjects?: boolean;
}) {
  const label = props.allProjects ? "All projects" : (props.name ?? "Unknown project");
  return (
    <td className="py-4 pr-3 align-middle">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={label}
              className="flex h-5 w-4 items-center text-muted-foreground"
              data-project-icon={props.allProjects ? "all" : props.project ? "project" : "unknown"}
            />
          }
        >
          {props.allProjects ? (
            <AllProjectsIcon className="size-4" />
          ) : props.project ? (
            <ProjectRowIcon project={props.project} />
          ) : (
            <FolderIcon className="size-4" />
          )}
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
    </td>
  );
}
