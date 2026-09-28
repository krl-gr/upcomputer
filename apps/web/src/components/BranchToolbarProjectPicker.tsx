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
 * favicon to link another project, or from "Select project" on a chat
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
 * A project linked to the chat (or waiting to be linked on first send):
 * favicon + name, with an `×` to remove it on hover.
 */
export const LinkedProjectChip = memo(function LinkedProjectChip(props: {
  readonly project: PickerProject;
  readonly pending?: boolean;
  readonly onRemove: () => void;
}) {
  const { project, pending = false, onRemove } = props;
  return (
    <span
      className={cn(
        "group/chip inline-flex h-6 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-md border px-1.5 text-muted-foreground text-xs",
        pending ? "border-dashed border-border/80" : "border-border/60",
      )}
      title={
        pending
          ? `${project.title} will be linked when you send the first message`
          : project.workspaceRoot
      }
      data-linked-project-chip=""
    >
      <ProjectFavicon
        environmentId={project.environmentId}
        cwd={project.workspaceRoot}
        repositoryIdentity={project.repositoryIdentity}
        className="size-3.5"
      />
      <span className="min-w-0 truncate">{project.title}</span>
      <button
        type="button"
        aria-label={`Unlink ${project.title}`}
        className="-me-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/chip:opacity-100 pointer-coarse:opacity-100"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
});
