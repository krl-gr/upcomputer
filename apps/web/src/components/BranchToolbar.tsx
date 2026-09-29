import { scopeProjectRef, scopeThreadRef } from "@upcomputer/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@upcomputer/contracts";
import { PlusIcon } from "lucide-react";
import { memo, useCallback, useMemo, type ReactNode } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { cn } from "../lib/utils";
import { selectLinkableProjects } from "../lib/threadProjectLinks";
import {
  selectPendingProjectLinks,
  usePendingProjectLinksStore,
} from "../pendingProjectLinksStore";
import {
  useProject,
  useProjects,
  useThread,
  useThreadShell,
  useThreadShellsForProjectRefs,
} from "../state/entities";
import { useIsMobile } from "../hooks/useMediaQuery";
import { useIsScratchProject } from "../hooks/useScratchProject";
import {
  useChooseProjectForChat,
  useThreadProjectLinkCommands,
} from "../hooks/useThreadProjectChoice";
import {
  type EnvMode,
  type EnvironmentOption,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveEffectiveEnvMode,
  resolveLockedWorkspaceLabel,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { BranchToolbarEnvModeSelector } from "./BranchToolbarEnvModeSelector";
import { BranchToolbarProjectPicker, LinkedProjectIcon } from "./BranchToolbarProjectPicker";
import { CONTEXT_BAR_SEPARATOR_CLASS, CONTEXT_BAR_TEXT_CLASS } from "./BranchToolbar.styles";
import { Button } from "./ui/button";
import { ProjectFavicon } from "./ProjectFavicon";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  onEnvModeChange: (mode: EnvMode) => void;
  effectiveEnvModeOverride?: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  envLocked: boolean;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  actions?: ReactNode;
  isGitRepo: boolean;
}

interface MobileRunContextSelectorProps {
  envLocked: boolean;
  envModeLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[] | undefined;
  showEnvironmentPicker: boolean;
  showEnvironmentIndicator: boolean;
  onEnvironmentChange: ((environmentId: EnvironmentId) => void) | undefined;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel: string | null;
  onUsePreviousWorktree: () => void;
}

const EMPTY_PROJECT_IDS: ReadonlyArray<ProjectId> = [];

function ContextBarSeparator() {
  return <div aria-hidden="true" className={CONTEXT_BAR_SEPARATOR_CLASS} />;
}

function ContextBarSlash() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 6 12"
      className="h-3 w-1.5 shrink-0 text-foreground/35 dark:text-border"
      fill="none"
    >
      <path d="M5.25 0.5L0.75 11.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

const MobileRunContextSelector = memo(function MobileRunContextSelector({
  envLocked,
  envModeLocked,
  environmentId,
  availableEnvironments,
  showEnvironmentPicker,
  showEnvironmentIndicator,
  onEnvironmentChange,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  previousWorktreeLabel,
  onUsePreviousWorktree,
}: MobileRunContextSelectorProps) {
  const activeEnvironment = useMemo(
    () => availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
    [availableEnvironments, environmentId],
  );
  const workspaceLabel = envModeLocked
    ? resolveLockedWorkspaceLabel(activeWorktreePath)
    : effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const isLocked = envLocked || envModeLocked;
  const triggerContent = (
    <span className="min-w-0 truncate">
      {showEnvironmentIndicator ? (activeEnvironment?.label ?? "Run on") : workspaceLabel}
    </span>
  );

  if (isLocked) {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 max-w-[48%] flex-1 items-center justify-start gap-1 rounded-md border border-transparent px-[calc(--spacing(2)-1px)] text-muted-foreground/70 md:hidden",
          CONTEXT_BAR_TEXT_CLASS,
        )}
      >
        {triggerContent}
      </span>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" />}
        className={cn(
          "min-w-0 max-w-[48%] flex-1 justify-start text-muted-foreground/70 hover:text-foreground/80 md:hidden",
          CONTEXT_BAR_TEXT_CLASS,
        )}
      >
        {triggerContent}
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="w-64">
        {showEnvironmentPicker && availableEnvironments && onEnvironmentChange ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>Run on</MenuGroupLabel>
              <MenuRadioGroup
                value={environmentId}
                onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
              >
                {availableEnvironments.map((env) => (
                  <MenuRadioItem
                    key={env.environmentId}
                    disabled={envLocked}
                    value={env.environmentId}
                  >
                    <span className="min-w-0 truncate">{env.label}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuRadioGroup
            value={effectiveEnvMode}
            onValueChange={(value) => {
              if (value === "previous-worktree") {
                onUsePreviousWorktree();
                return;
              }
              onEnvModeChange(value as EnvMode);
            }}
          >
            <MenuRadioItem disabled={envModeLocked} value="local">
              <span className="min-w-0 truncate">
                {resolveCurrentWorkspaceLabel(activeWorktreePath)}
              </span>
            </MenuRadioItem>
            <MenuRadioItem disabled={envModeLocked} value="worktree">
              <span className="min-w-0 truncate">{resolveEnvModeLabel("worktree")}</span>
            </MenuRadioItem>
            {previousWorktreeLabel ? (
              <MenuRadioItem disabled={envModeLocked} value="previous-worktree">
                <span className="min-w-0 truncate">{previousWorktreeLabel}</span>
              </MenuRadioItem>
            ) : null}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});

export const BranchToolbar = memo(function BranchToolbar({
  environmentId,
  threadId,
  draftId,
  onEnvModeChange,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  envLocked,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  actions,
  isGitRepo,
}: BranchToolbarProps) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThread = useThread(threadRef);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const hasActiveThread = serverThread !== null || draftThread !== null;
  // The shell carries links as soon as the thread exists, before its detail loads.
  const serverThreadShell = useThreadShell(threadRef);
  const isServerThread = serverThread !== null || serverThreadShell !== null;
  const isScratchProjectFn = useIsScratchProject();
  const isScratch = activeProject !== null && isScratchProjectFn(activeProject);
  const pendingLinkDraftId = !isServerThread && draftId ? draftId : null;
  const pendingLinks = usePendingProjectLinksStore((store) =>
    selectPendingProjectLinks(store, pendingLinkDraftId),
  );
  const removePendingLink = usePendingProjectLinksStore((store) => store.removeLink);
  const linkedProjectIds = isServerThread
    ? (serverThreadShell?.linkedProjectIds ?? serverThread?.linkedProjectIds ?? EMPTY_PROJECT_IDS)
    : EMPTY_PROJECT_IDS;
  const allProjects = useProjects();
  const projectById = useMemo(
    () =>
      new Map(
        allProjects
          .filter((project) => project.environmentId === environmentId)
          .map((project) => [project.id, project] as const),
      ),
    [allProjects, environmentId],
  );
  // Linked projects (started threads) or projects waiting to be linked on
  // the first send (drafts). Unknown ids (deleted projects) are skipped.
  const chipProjects = useMemo(() => {
    const ids = isServerThread
      ? linkedProjectIds
      : pendingLinks
          .filter((link) => link.environmentId === environmentId)
          .map((link) => link.projectId);
    return ids.flatMap((id) => {
      const project = projectById.get(id);
      return project && project.id !== activeProject?.id ? [project] : [];
    });
  }, [
    activeProject?.id,
    environmentId,
    isServerThread,
    linkedProjectIds,
    pendingLinks,
    projectById,
  ]);
  const menuProjects = useMemo(
    () =>
      selectLinkableProjects({
        projects: allProjects,
        environmentId,
        isScratchProject: isScratchProjectFn,
        excludedProjectIds: [
          ...(activeProject && !isScratch ? [activeProject.id] : []),
          ...chipProjects.map((project) => project.id),
        ],
      }),
    [activeProject, allProjects, chipProjects, environmentId, isScratch, isScratchProjectFn],
  );
  const chooseProject = useChooseProjectForChat({
    threadRef,
    draftId: draftId ?? null,
    isServerThread,
    isScratchProject: isScratch,
  });
  const { unlink } = useThreadProjectLinkCommands();
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveEnvMode =
    effectiveEnvModeOverride ??
    resolveEffectiveEnvMode({
      activeWorktreePath,
      hasServerThread: serverThread !== null,
      draftThreadEnvMode: draftThread?.envMode,
    });
  const envModeLocked =
    envLocked || !isGitRepo || (serverThread !== null && activeWorktreePath !== null);

  // "Previous worktree" hops a draft into the most recently active worktree
  // of this project — the "keep going where I just was" follow-up flow. Only
  // drafts can hop; started server threads have their workspace pinned.
  const canUsePreviousWorktree = draftThread !== null && serverThread === null && !envModeLocked;
  const projectRefsForWorktreeLookup = useMemo(
    () => (canUsePreviousWorktree && activeProjectRef ? [activeProjectRef] : []),
    [canUsePreviousWorktree, activeProjectRef],
  );
  const projectThreads = useThreadShellsForProjectRefs(projectRefsForWorktreeLookup);
  const previousWorktreeSeed = useMemo(
    () =>
      canUsePreviousWorktree
        ? resolvePreviousWorktreeSeed({
            threads: projectThreads,
            currentWorktreePath: activeWorktreePath,
          })
        : null,
    [activeWorktreePath, canUsePreviousWorktree, projectThreads],
  );
  const previousWorktreeLabel = previousWorktreeSeed
    ? resolvePreviousWorktreeLabel(previousWorktreeSeed)
    : null;
  const onUsePreviousWorktree = useCallback(() => {
    if (!previousWorktreeSeed || !activeProjectRef) return;
    // Same shape the branch selector writes when picking a branch that
    // already lives in a worktree: point the draft at the existing tree.
    setDraftThreadContext(draftId ?? threadRef, {
      branch: previousWorktreeSeed.branch,
      worktreePath: previousWorktreeSeed.worktreePath,
      envMode: "worktree",
      projectRef: activeProjectRef,
    });
  }, [activeProjectRef, draftId, previousWorktreeSeed, setDraftThreadContext, threadRef]);

  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );
  const activeEnvironmentOption =
    availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null;
  const showEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: showEnvironmentPicker,
  });
  const isMobile = useIsMobile();

  if (!hasActiveThread || !activeProject) return null;

  // Projects linked to the chat (or waiting to be linked on the first send)
  // as icons, followed by a `+` that links another one.
  const linkedProjectIcons =
    chipProjects.length > 0 ? (
      <div className="flex min-w-0 shrink items-center gap-1 overflow-hidden ps-1">
        {chipProjects.map((project) => (
          <LinkedProjectIcon
            key={project.id}
            project={project}
            pending={!isServerThread}
            onRemove={() => {
              if (isServerThread) {
                void unlink(threadRef, project.id);
              } else if (draftId) {
                removePendingLink(draftId, {
                  environmentId: project.environmentId,
                  projectId: project.id,
                });
              }
            }}
          />
        ))}
        <BranchToolbarProjectPicker
          projects={menuProjects}
          onSelect={chooseProject}
          trigger="icon"
          ariaLabel="Add project"
        >
          <PlusIcon className="size-4" />
        </BranchToolbarProjectPicker>
      </div>
    ) : null;
  // The project's favicon opens the menu to link another project.
  const projectFaviconPicker = (
    <BranchToolbarProjectPicker
      projects={menuProjects}
      onSelect={chooseProject}
      trigger="icon"
      ariaLabel="Link another project to this chat"
    >
      <ProjectFavicon
        environmentId={activeProject.environmentId}
        cwd={activeProject.workspaceRoot}
        repositoryIdentity={activeProject.repositoryIdentity}
        className="size-4"
      />
    </BranchToolbarProjectPicker>
  );

  return (
    <div
      className="mx-auto flex w-full max-w-208 min-w-0 items-center justify-between gap-2 pb-1 pl-3 pr-4 pt-1 dark:drop-shadow-[0_4px_2px_rgba(0,0,0,0.25)]"
      data-chat-context-bar="true"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0 overflow-hidden">
        {isScratch ? (
          // A chat without a project runs in its own plain folder: no
          // workspace mode, branch or environment controls.
          (linkedProjectIcons ?? (
            <BranchToolbarProjectPicker
              projects={menuProjects}
              onSelect={chooseProject}
              trigger="text"
              ariaLabel="Add project"
            >
              Add project
            </BranchToolbarProjectPicker>
          ))
        ) : !isGitRepo ? (
          <>
            <BranchToolbarProjectPicker
              projects={menuProjects}
              onSelect={chooseProject}
              trigger="text"
              ariaLabel="Link another project to this chat"
            >
              <ProjectFavicon
                environmentId={activeProject.environmentId}
                cwd={activeProject.workspaceRoot}
                repositoryIdentity={activeProject.repositoryIdentity}
                className="size-4"
              />
              <span className="min-w-0 truncate">{activeProject.title}</span>
            </BranchToolbarProjectPicker>
            {linkedProjectIcons}
          </>
        ) : isMobile ? (
          <>
            {projectFaviconPicker}
            <MobileRunContextSelector
              envLocked={envLocked}
              envModeLocked={envModeLocked}
              environmentId={environmentId}
              availableEnvironments={availableEnvironments}
              showEnvironmentPicker={showEnvironmentPicker}
              showEnvironmentIndicator={showEnvironmentIndicator}
              previousWorktreeLabel={previousWorktreeLabel}
              onUsePreviousWorktree={onUsePreviousWorktree}
              onEnvironmentChange={onEnvironmentChange}
              effectiveEnvMode={effectiveEnvMode}
              activeWorktreePath={activeWorktreePath}
              onEnvModeChange={onEnvModeChange}
            />
            <ContextBarSeparator />
            <BranchToolbarBranchSelector
              className="min-w-0 flex-initial justify-start"
              environmentId={environmentId}
              threadId={threadId}
              {...(draftId ? { draftId } : {})}
              envLocked={envLocked}
              {...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {})}
              {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
              {...(onActiveThreadBranchOverrideChange
                ? { onActiveThreadBranchOverrideChange }
                : {})}
              startFromOrigin={startFromOrigin}
              onStartFromOriginChange={onStartFromOriginChange}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
            {linkedProjectIcons}
          </>
        ) : (
          <>
            <div className="flex min-w-0 shrink-0 items-center gap-0">
              {projectFaviconPicker}
              <ContextBarSlash />
              {showEnvironmentPicker && availableEnvironments && onEnvironmentChange ? (
                <>
                  <BranchToolbarEnvironmentSelector
                    envLocked={envLocked}
                    environmentId={environmentId}
                    availableEnvironments={availableEnvironments}
                    onEnvironmentChange={onEnvironmentChange}
                  />
                  <ContextBarSeparator />
                </>
              ) : null}
              <BranchToolbarEnvModeSelector
                envLocked={envModeLocked}
                effectiveEnvMode={effectiveEnvMode}
                activeWorktreePath={activeWorktreePath}
                onEnvModeChange={onEnvModeChange}
              />
            </div>
            <ContextBarSeparator />
            <BranchToolbarBranchSelector
              className="min-w-0 flex-initial justify-start"
              environmentId={environmentId}
              threadId={threadId}
              {...(draftId ? { draftId } : {})}
              envLocked={envLocked}
              {...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {})}
              {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
              {...(onActiveThreadBranchOverrideChange
                ? { onActiveThreadBranchOverrideChange }
                : {})}
              startFromOrigin={startFromOrigin}
              onStartFromOriginChange={onStartFromOriginChange}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
            {linkedProjectIcons}
          </>
        )}
      </div>
      {actions}
    </div>
  );
});
