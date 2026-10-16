import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
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
import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../components/WorkspaceBreadcrumb";
import { useComposerDraftStore } from "../composerDraftStore";
import { useScratchProject } from "../hooks/useScratchProject";
import { useProject, useProjects, useThreadShell, useThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  resolveLinkedProjects,
  resolveProjectChoiceEffect,
  searchProjectsByTitle,
} from "./contextRowProjects";
import { useRetargetDraftToProject } from "./useRetargetDraftToProject";

const EMPTY_PROJECT_IDS: ReadonlyArray<string> = [];
const MAX_LINKED_ICONS = 3;

/** A chat without a project: a dashed rounded square where a project icon would be. */
function NoProjectIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 shrink-0 rounded-[25%] border border-current border-dashed"
      data-thread-header-no-project=""
    />
  );
}

/**
 * The chat's projects at the start of the header, where upstream shows its
 * project: the own project's icon and name, the linked projects' icons, or the
 * no-project square. It opens a searchable list to link and unlink projects
 * (`linkedProjectIds`). An unsent chat without a project moves into the chosen
 * one instead; an unsent chat in a project links more after its first message.
 */
export const ThreadHeaderProjects = memo(function ThreadHeaderProjects(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, threadId } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThread = useThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const draftId = useComposerDraftStore((store) => store.getDraftIdByRef(threadRef));
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const threadProject = useProject(projectRef);
  const projects = useProjects();
  const threads = useThreadShells();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  const retargetDraft = useRetargetDraftToProject();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const scratchRoot = scratchWorkspaceRootFor(environmentId);
  const isScratch = threadProject !== null && isScratchProject(threadProject, scratchRoot);
  const ownProject = threadProject && !isScratch ? threadProject : null;
  const linkedProjectIds = serverThread?.linkedProjectIds ?? EMPTY_PROJECT_IDS;
  const linkedProjects = useMemo(
    () =>
      resolveLinkedProjects({
        projects,
        environmentId,
        ownProjectId: threadProject?.id ?? "",
        linkedProjectIds,
      }),
    [environmentId, linkedProjectIds, projects, threadProject],
  );
  // The chat's own project first, then the others, most recently active first.
  const otherProjects = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      project.id !== ownProject?.id &&
      !isScratchProject(project, scratchRoot),
  );
  const menuProjects = [
    ...(ownProject ? [ownProject] : []),
    ...(open ? sortScopedProjectsForSidebar(otherProjects, threads, "updated_at") : otherProjects),
  ];
  const projectById = new Map(menuProjects.map((project) => [project.id as string, project]));
  const filteredIds = searchProjectsByTitle(menuProjects, query).map(
    (project) => project.id as string,
  );
  const selectedIds = [
    ...(ownProject ? [ownProject.id as string] : []),
    ...linkedProjects.map((project) => project.id as string),
  ];
  const choiceEffect = resolveProjectChoiceEffect({
    isServerThread: serverThread !== null,
    isScratch,
  });

  if (serverThread === null && draftThread === null) return null;

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const onValueChange = (next: ReadonlyArray<string>) => {
    const nextIds = new Set(next);
    const selected = new Set(selectedIds);
    const added = next.filter((id) => !selected.has(id));
    const removed = selectedIds.filter((id) => !nextIds.has(id) && id !== ownProject?.id);
    if (choiceEffect === "link" && (added.length > 0 || removed.length > 0)) {
      void updateMetadata({
        environmentId,
        input: {
          threadId,
          ...(added.length > 0 ? { linkProjectIds: added as EnvironmentProject["id"][] } : {}),
          ...(removed.length > 0
            ? { unlinkProjectIds: removed as EnvironmentProject["id"][] }
            : {}),
        },
      });
      return;
    }
    const chosen = added[0] === undefined ? undefined : projectById.get(added[0]);
    if (choiceEffect === "retarget" && draftId && chosen) {
      close();
      retargetDraft(draftId, chosen);
    }
  };

  const projectNames = [ownProject, ...linkedProjects].flatMap((project) =>
    project ? [project.title] : [],
  );
  const label = projectNames.length === 0 ? "No project" : projectNames.join(", ");
  const hiddenLinkedCount = linkedProjects.length - MAX_LINKED_ICONS;

  return (
    <>
      <WorkspaceBreadcrumbItem className="shrink">
        <Combobox
          multiple
          items={menuProjects.map((project) => project.id as string)}
          filteredItems={filteredIds}
          open={open}
          value={selectedIds as string[]}
          onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : close())}
          onValueChange={onValueChange}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <ComboboxTrigger
                  ref={triggerRef}
                  render={
                    <button
                      type="button"
                      className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-expanded:text-foreground"
                    />
                  }
                  aria-label={`Projects: ${label}`}
                  data-thread-header-projects=""
                />
              }
            >
              {ownProject === null && linkedProjects.length === 0 ? <NoProjectIcon /> : null}
              {ownProject ? (
                <>
                  <ProjectFavicon project={ownProject} className="size-3.5" />
                  {/* The name gives way to the thread title on narrow screens. */}
                  <WorkspaceBreadcrumbText className="max-w-40 max-sm:hidden">
                    {ownProject.title}
                  </WorkspaceBreadcrumbText>
                </>
              ) : null}
              {linkedProjects.length > 0 ? (
                <span className="flex shrink-0 items-center gap-1">
                  {linkedProjects.slice(0, MAX_LINKED_ICONS).map((project) => (
                    <ProjectFavicon key={project.id} project={project} className="size-3.5" />
                  ))}
                  {hiddenLinkedCount > 0 ? (
                    <span className="text-xs tabular-nums">+{hiddenLinkedCount}</span>
                  ) : null}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipPopup side="bottom">{label}</TooltipPopup>
          </Tooltip>
          <ComboboxPopup align="start" side="bottom" anchor={triggerRef} className="w-72">
            <ComboboxSearchInput
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ComboboxEmpty>
              {menuProjects.length === 0 ? "No projects yet." : "No matching projects."}
            </ComboboxEmpty>
            <ComboboxList className="max-h-64">
              {filteredIds.map((id) => {
                const project = projectById.get(id);
                if (!project) return null;
                const selected = selectedIds.includes(id);
                return (
                  <ComboboxItem
                    hideIndicator
                    key={id}
                    value={id}
                    disabled={project.id === ownProject?.id || choiceEffect === null}
                  >
                    <ProjectFavicon project={project} className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    {selected ? <CheckIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
                  </ComboboxItem>
                );
              })}
            </ComboboxList>
            <div className="shrink-0 border-t border-border/60 p-1">
              {choiceEffect === null ? (
                <p className="px-2 py-1 text-muted-foreground text-xs">
                  Link more projects after the first message.
                </p>
              ) : null}
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
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator>
        <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
      </WorkspaceBreadcrumbSeparator>
    </>
  );
});
