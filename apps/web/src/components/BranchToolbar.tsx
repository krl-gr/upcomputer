import { scopeProjectRef, scopeThreadRef } from "@upcomputer/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@upcomputer/contracts";
import {
  ChevronDownIcon,
  CloudIcon,
  FolderGit2Icon,
  FolderGitIcon,
  FolderIcon,
  HistoryIcon,
  MonitorIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, type ReactNode } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { cn } from "../lib/utils";
import { useProject, useThread, useThreadShellsForProjectRefs } from "../state/entities";
import { useIsMobile } from "../hooks/useMediaQuery";
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
import {
  CONTEXT_BAR_ICON_TRIGGER_CLASS,
  CONTEXT_BAR_SEPARATOR_CLASS,
  CONTEXT_BAR_TEXT_CLASS,
} from "./BranchToolbar.styles";
import { Button } from "./ui/button";
import { ProjectFavicon } from "./ProjectFavicon";
import { SIDEBAR_MUTED_TEXT_CLASS } from "./sidebar/sidebarTextStyles";
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
  onCheckoutPullRequestRequest?: (reference: string) => void;
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
  const WorkspaceIcon =
    effectiveEnvMode === "worktree"
      ? FolderGit2Icon
      : activeWorktreePath
        ? FolderGitIcon
        : FolderIcon;
  const workspaceLabel = envModeLocked
    ? resolveLockedWorkspaceLabel(activeWorktreePath)
    : effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const isLocked = envLocked || envModeLocked;
  const EnvironmentIcon = activeEnvironment?.isPrimary ? MonitorIcon : CloudIcon;
  const icon = showEnvironmentIndicator ? (
    // Button's base styles apply `-mx-0.5` to descendant SVGs, which eats 4px
    // out of whatever gap we set. mx-0! cancels that so gap-0.5 reads as 2px.
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <EnvironmentIcon className="size-3 shrink-0 mx-0!" />
      <WorkspaceIcon className="size-3 shrink-0 mx-0!" />
    </span>
  ) : (
    <WorkspaceIcon className="size-3 shrink-0" />
  );
  const triggerContent = (
    <>
      {icon}
      <span className="min-w-0 truncate">
        {showEnvironmentIndicator ? (activeEnvironment?.label ?? "Run on") : workspaceLabel}
      </span>
    </>
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
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
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
                {availableEnvironments.map((env) => {
                  const Icon = env.isPrimary ? MonitorIcon : CloudIcon;
                  return (
                    <MenuRadioItem
                      key={env.environmentId}
                      disabled={envLocked}
                      value={env.environmentId}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon className="size-3" />
                        <span className="min-w-0 truncate">{env.label}</span>
                      </span>
                    </MenuRadioItem>
                  );
                })}
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
              <span className="flex min-w-0 items-center gap-1.5">
                {activeWorktreePath ? (
                  <FolderGitIcon className="size-3" />
                ) : (
                  <FolderIcon className="size-3" />
                )}
                <span className="min-w-0 truncate">
                  {resolveCurrentWorkspaceLabel(activeWorktreePath)}
                </span>
              </span>
            </MenuRadioItem>
            <MenuRadioItem disabled={envModeLocked} value="worktree">
              <span className="flex min-w-0 items-center gap-1.5">
                <FolderGit2Icon className="size-3" />
                <span className="min-w-0 truncate">{resolveEnvModeLabel("worktree")}</span>
              </span>
            </MenuRadioItem>
            {previousWorktreeLabel ? (
              <MenuRadioItem disabled={envModeLocked} value="previous-worktree">
                <span className="flex min-w-0 items-center gap-1.5">
                  <HistoryIcon className="size-3" />
                  <span className="min-w-0 truncate">{previousWorktreeLabel}</span>
                </span>
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
  onCheckoutPullRequestRequest,
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

  return (
    <div
      className="mx-auto flex w-full max-w-208 min-w-0 items-center justify-between gap-2 pb-1 pl-3 pr-4 pt-1 dark:drop-shadow-[0_4px_2px_rgba(0,0,0,0.25)]"
      data-chat-context-bar="true"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0 overflow-hidden">
        {!isGitRepo ? (
          <div
            className="flex h-8 min-w-0 shrink-0 items-center gap-2 px-2 text-left"
            title={activeProject.workspaceRoot}
          >
            <ProjectFavicon
              environmentId={activeProject.environmentId}
              cwd={activeProject.workspaceRoot}
              repositoryIdentity={activeProject.repositoryIdentity}
              className="size-4 dark:text-white/[0.175]"
            />
            <span
              className={cn("min-w-0 truncate", SIDEBAR_MUTED_TEXT_CLASS, CONTEXT_BAR_TEXT_CLASS)}
            >
              {activeProject.title}
            </span>
          </div>
        ) : isMobile ? (
          <>
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
              className="min-w-0 flex-1 justify-start"
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
              {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
          </>
        ) : (
          <>
            <div className="flex min-w-0 shrink-0 items-center gap-0">
              <span className={CONTEXT_BAR_ICON_TRIGGER_CLASS} aria-hidden="true">
                <ProjectFavicon
                  environmentId={activeProject.environmentId}
                  cwd={activeProject.workspaceRoot}
                  repositoryIdentity={activeProject.repositoryIdentity}
                  className="size-4"
                />
              </span>
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
              className="min-w-0 flex-1 justify-start"
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
              {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
          </>
        )}
      </div>
      {actions}
    </div>
  );
});
