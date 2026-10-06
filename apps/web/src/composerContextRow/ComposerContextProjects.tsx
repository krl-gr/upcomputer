import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { PlusIcon, XIcon } from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useComposerMenuProps } from "../components/chat/composerEventScope";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../components/ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { useThreadShells } from "../state/entities";
import { searchProjectsByTitle } from "./contextRowProjects";
import { CONTEXT_ROW_ICON_BUTTON_CLASS } from "./contextRowStyles";

type RowProject = Pick<
  EnvironmentProject,
  "id" | "environmentId" | "title" | "workspaceRoot" | "faviconPath" | "projectIcon"
>;

/**
 * The searchable project menu V1 opened from `+` under the composer, with
 * "New project…" at the bottom (the command palette's Add project).
 */
function ProjectPickerInner<Project extends RowProject>(props: {
  readonly projects: ReadonlyArray<Project>;
  readonly onSelect: (project: Project) => void;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const { projects, onSelect, label, children } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const threads = useThreadShells();
  const floatingLayerProps = useComposerMenuProps();
  // Most recently active first, like the sidebar's "recent" order.
  const orderedProjects = useMemo(
    () => (open ? sortScopedProjectsForSidebar(projects, threads, "updated_at") : projects),
    [open, projects, threads],
  );
  const filteredProjects = useMemo(
    () => searchProjectsByTitle(orderedProjects, query),
    [orderedProjects, query],
  );
  const projectById = useMemo(
    () => new Map(orderedProjects.map((project) => [project.id as string, project] as const)),
    [orderedProjects],
  );
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Combobox
      items={orderedProjects.map((project) => project.id as string)}
      filteredItems={filteredProjects.map((project) => project.id as string)}
      autoHighlight
      open={open}
      value={null}
      onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : close())}
      onValueChange={(value) => {
        const project = typeof value === "string" ? projectById.get(value) : undefined;
        if (!project) return;
        close();
        onSelect(project);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<button type="button" className={CONTEXT_ROW_ICON_BUTTON_CLASS} />}
              aria-label={label}
              data-context-row-project-picker=""
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <ComboboxPopup align="start" side="top" className="w-72" {...floatingLayerProps}>
        <ComboboxSearchInput
          placeholder="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>
          {projects.length === 0 ? "No other projects yet." : "No matching projects."}
        </ComboboxEmpty>
        <ComboboxList className="max-h-64">
          {filteredProjects.map((project) => (
            <ComboboxItem hideIndicator key={project.id} value={project.id as string}>
              <span className="flex min-w-0 items-center gap-2">
                <ProjectFavicon project={project} className="size-4" />
                <span className="min-w-0 truncate">{project.title}</span>
              </span>
            </ComboboxItem>
          ))}
        </ComboboxList>
        <div className="shrink-0 border-t border-border/60 p-1">
          <button
            type="button"
            className="flex h-7 w-full items-center rounded-sm px-2 text-left text-muted-foreground text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              close();
              openCommandPalette({ open: "add-project" });
            }}
          >
            New project…
          </button>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}

const ProjectPicker = memo(ProjectPickerInner) as typeof ProjectPickerInner;

/**
 * A project linked to the chat: its icon, turning into an `×` that unlinks it
 * on hover or focus, as V1's was. The name is in the tooltip. Touch screens
 * keep the icon and show a small `×` badge.
 */
const LinkedProjectIcon = memo(function LinkedProjectIcon(props: {
  readonly project: RowProject;
  readonly onUnlink: () => void;
}) {
  const { project, onUnlink } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Unlink ${project.title}`}
            className={cn(CONTEXT_ROW_ICON_BUTTON_CLASS, "group/linked relative")}
            onClick={onUnlink}
            data-context-row-linked-project={project.id}
          />
        }
      >
        <span className="inline-flex transition-opacity group-hover/linked:opacity-0 group-focus-visible/linked:opacity-0 pointer-coarse:opacity-100!">
          <ProjectFavicon project={project} className="size-4" />
        </span>
        <span
          aria-hidden
          className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover/linked:opacity-100 group-focus-visible/linked:opacity-100 pointer-coarse:inset-auto pointer-coarse:-top-0.5 pointer-coarse:-right-0.5 pointer-coarse:size-3 pointer-coarse:rounded-full pointer-coarse:bg-muted pointer-coarse:opacity-100"
        >
          <XIcon className="size-3.5 pointer-coarse:size-2.5" />
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">{`${project.title} · Remove`}</TooltipPopup>
    </Tooltip>
  );
});

export interface ComposerContextProjectsProps<Project extends RowProject> {
  /** The chat's own project, or null for a chat without a project. */
  readonly ownProject: Project | null;
  readonly linkedProjects: ReadonlyArray<Project>;
  /** The `+` menu's projects. */
  readonly linkableProjects: ReadonlyArray<Project>;
  /** Null hides `+`: the chat cannot take another project yet. */
  readonly onChooseProject: ((project: Project) => void) | null;
  readonly onUnlinkProject: (project: Project) => void;
}

/**
 * The start of the row: the chat's own project, its linked projects, then
 * `+` to link another one. A chat without a project shows only its links
 * and `+`.
 */
function ComposerContextProjectsInner<Project extends RowProject>(
  props: ComposerContextProjectsProps<Project>,
) {
  const { ownProject, linkedProjects, linkableProjects, onChooseProject, onUnlinkProject } = props;
  return (
    <div className="flex min-w-0 shrink items-center overflow-hidden" data-context-row-projects="">
      {ownProject ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={CONTEXT_ROW_ICON_BUTTON_CLASS}
                data-context-row-own-project={ownProject.id}
              />
            }
          >
            <ProjectFavicon project={ownProject} className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="top">{ownProject.title}</TooltipPopup>
        </Tooltip>
      ) : null}
      {linkedProjects.map((project) => (
        <LinkedProjectIcon
          key={project.id}
          project={project}
          onUnlink={() => onUnlinkProject(project)}
        />
      ))}
      {onChooseProject ? (
        <ProjectPicker
          projects={linkableProjects}
          onSelect={onChooseProject}
          label={ownProject ? "Link a project" : "Add project"}
        >
          <PlusIcon className="size-4" />
        </ProjectPicker>
      ) : null}
    </div>
  );
}

export const ComposerContextProjects = memo(
  ComposerContextProjectsInner,
) as typeof ComposerContextProjectsInner;
