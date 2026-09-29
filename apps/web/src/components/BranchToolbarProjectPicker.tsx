import type { EnvironmentProject } from "@upcomputer/client-runtime/state/shell";
import { XIcon } from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { searchProjectsByTitle } from "../lib/threadProjectLinks";
import { cn } from "../lib/utils";
import { useThreadShells } from "../state/entities";
import {
  CONTEXT_BAR_ICON_TRIGGER_CLASS,
  CONTEXT_BAR_TEXT_TRIGGER_CLASS,
} from "./BranchToolbar.styles";
import { ProjectFavicon } from "./ProjectFavicon";
import { sortScopedProjectsForSidebar } from "./Sidebar.logic";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "./ui/combobox";

type PickerProject = Pick<
  EnvironmentProject,
  "id" | "environmentId" | "title" | "workspaceRoot" | "repositoryIdentity"
>;

interface BranchToolbarProjectPickerProps<T extends PickerProject> {
  /** Candidates, already filtered (no "No project", no current/linked ones). */
  readonly projects: ReadonlyArray<T>;
  readonly onSelect: (project: T) => void;
  /** `icon` for the project's favicon, `text` for a plain label. */
  readonly trigger: "icon" | "text";
  readonly ariaLabel: string;
  readonly children: ReactNode;
}

/**
 * Searchable project menu under the composer, opened from the project's
 * favicon to link another project, or from "Add project" / `+` on a chat
 * without a project.
 */
function BranchToolbarProjectPickerInner<T extends PickerProject>({
  projects,
  onSelect,
  trigger,
  ariaLabel,
  children,
}: BranchToolbarProjectPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const threads = useThreadShells();
  // Most recently active first, like the sidebar's "recent" order.
  const orderedProjects = useMemo(
    () => (open ? sortScopedProjectsForSidebar(projects, threads, "updated_at") : projects),
    [open, projects, threads],
  );
  const filteredProjects = useMemo(
    () => searchProjectsByTitle(orderedProjects, query),
    [orderedProjects, query],
  );
  const projectByKey = useMemo(
    () => new Map(orderedProjects.map((project) => [project.id as string, project] as const)),
    [orderedProjects],
  );
  const itemKeys = useMemo(
    () => orderedProjects.map((project) => project.id as string),
    [orderedProjects],
  );
  const filteredKeys = useMemo(
    () => filteredProjects.map((project) => project.id as string),
    [filteredProjects],
  );

  return (
    <Combobox
      items={itemKeys}
      filteredItems={filteredKeys}
      autoHighlight
      open={open}
      value={null}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      onValueChange={(value) => {
        const project = typeof value === "string" ? projectByKey.get(value) : undefined;
        if (!project) return;
        setOpen(false);
        setQuery("");
        onSelect(project);
      }}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size={trigger === "icon" ? "icon-sm" : "xs"} />}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={
          trigger === "icon"
            ? CONTEXT_BAR_ICON_TRIGGER_CLASS
            : cn(CONTEXT_BAR_TEXT_TRIGGER_CLASS, "gap-2")
        }
        data-project-picker-trigger=""
      >
        {children}
      </ComboboxTrigger>
      <ComboboxPopup
        align="start"
        side="top"
        className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0 [&>[data-slot=combobox-popup]]:overflow-hidden"
      >
        <ComboboxSearchInput
          placeholder="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty className="not-empty:px-3 text-left">
          {projects.length === 0 ? "No other projects yet." : "No matching projects."}
        </ComboboxEmpty>
        <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
          {filteredProjects.map((project) => (
            <ComboboxItem
              hideIndicator
              key={project.id}
              value={project.id as string}
              className="w-full min-w-0"
              contentClassName="w-full min-w-0 overflow-hidden"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ProjectFavicon
                  environmentId={project.environmentId}
                  cwd={project.workspaceRoot}
                  repositoryIdentity={project.repositoryIdentity}
                  className="size-4"
                />
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
              setOpen(false);
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

export const BranchToolbarProjectPicker = memo(
  BranchToolbarProjectPickerInner,
) as typeof BranchToolbarProjectPickerInner;

/**
 * A project linked to the chat (or waiting to be linked on first send): its
 * icon, turning into an `×` that unlinks it on hover or focus. The name lives
 * in the tooltip. Touch screens keep the icon and show a small `×` badge.
 */
export const LinkedProjectIcon = memo(function LinkedProjectIcon(props: {
  readonly project: PickerProject;
  readonly pending?: boolean;
  readonly onRemove: () => void;
}) {
  const { project, pending = false, onRemove } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Unlink ${project.title}`}
            className={cn(
              "group/linked relative inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
              pending && "outline-1 -outline-offset-1 outline-dashed outline-border/80",
            )}
            onClick={onRemove}
            data-linked-project-icon=""
          />
        }
      >
        <span
          className={cn(
            "inline-flex transition-opacity group-hover/linked:opacity-0 group-focus-visible/linked:opacity-0 pointer-coarse:opacity-100!",
            pending && "opacity-60",
          )}
        >
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.workspaceRoot}
            repositoryIdentity={project.repositoryIdentity}
            className="size-4"
          />
        </span>
        <span
          aria-hidden
          className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover/linked:opacity-100 group-focus-visible/linked:opacity-100 pointer-coarse:inset-auto pointer-coarse:-top-0.5 pointer-coarse:-right-0.5 pointer-coarse:size-3 pointer-coarse:rounded-full pointer-coarse:bg-muted pointer-coarse:opacity-100"
        >
          <XIcon className="size-3.5 pointer-coarse:size-2.5" />
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {pending
          ? `${project.title} · linked when you send the first message · Remove`
          : `${project.title} · Remove`}
      </TooltipPopup>
    </Tooltip>
  );
});
