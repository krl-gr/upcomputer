import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type Ref, memo, useImperativeHandle, useRef } from "react";

import type { BranchToolbarHandle } from "../components/BranchToolbar";
import {
  type EnvMode,
  type EnvironmentOption,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
  shouldShowEnvironmentIndicator,
} from "../components/BranchToolbar.logic";
import {
  BranchToolbarBranchSelector,
  type BranchToolbarBranchSelectorHandle,
} from "../components/BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "../components/BranchToolbarEnvironmentSelector";
import { BranchToolbarEnvModeSelector } from "../components/BranchToolbarEnvModeSelector";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useScratchProject } from "../hooks/useScratchProject";
import { useProject, useThreadShell, useThreadShellsForProjectRefs } from "../state/entities";
import { hasContextRowControls, resolveContextRowControls } from "./contextRowControls";
import { CONTEXT_ROW_QUIET_CONTROLS_CLASS, CONTEXT_ROW_SEPARATOR_CLASS } from "./contextRowStyles";

export interface UpComputerComposerContextRowProps {
  ref?: Ref<BranchToolbarHandle>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  isGitRepo: boolean;
  /** Several models selected: each starts in its own worktree. */
  forceNewWorktree: boolean;
  /** The thread's env mode as ChatView resolves it. */
  envMode: EnvMode;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
}

function ContextRowSeparator() {
  return <span aria-hidden="true" className={CONTEXT_ROW_SEPARATOR_CLASS} />;
}

/**
 * The row under the composer, as V1 had it: upstream's checkout mode, then `|`
 * upstream's branch. The chat's projects (`ThreadHeaderProjects`) and the panel
 * toggles are in the header, as upstream's. The workspace state and actions are upstream's
 * (`BranchToolbar` decides them the same way); only the form is V1's.
 */
export const UpComputerComposerContextRow = memo(function UpComputerComposerContextRow({
  ref,
  environmentId,
  threadId,
  draftId,
  isGitRepo,
  forceNewWorktree,
  envMode,
  onEnvModeChange,
  envLocked,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  autoEnvironmentLabel,
  onAutoEnvironment,
}: UpComputerComposerContextRowProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  const threadRef = scopeThreadRef(environmentId, threadId);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const serverThread = useThreadShell(threadRef);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const { scratchWorkspaceRootFor } = useScratchProject();

  // The workspace state, decided as upstream's BranchToolbar decides it.
  const activeWorktreePath = forceNewWorktree
    ? null
    : (serverThread?.worktreePath ?? draftThread?.worktreePath ?? null);
  const effectiveEnvMode = forceNewWorktree ? "worktree" : envMode;
  const envModeLocked = envLocked || (serverThread !== null && activeWorktreePath !== null);
  const canUsePreviousWorktree =
    draftThread !== null && serverThread === null && !envModeLocked && !forceNewWorktree;
  const projectRefsForWorktreeLookup =
    canUsePreviousWorktree && activeProjectRef ? [activeProjectRef] : [];
  const projectThreads = useThreadShellsForProjectRefs(projectRefsForWorktreeLookup);
  const previousWorktreeSeed = canUsePreviousWorktree
    ? resolvePreviousWorktreeSeed({
        threads: projectThreads,
        currentWorktreePath: activeWorktreePath,
      })
    : null;
  const previousWorktreeLabel = previousWorktreeSeed
    ? resolvePreviousWorktreeLabel(previousWorktreeSeed)
    : null;
  const onUsePreviousWorktree = () => {
    if (!previousWorktreeSeed || !activeProjectRef) return;
    setDraftThreadContext(draftId ?? threadRef, {
      branch: previousWorktreeSeed.branch,
      worktreePath: previousWorktreeSeed.worktreePath,
      envMode: "worktree",
      projectRef: activeProjectRef,
    });
  };

  const isScratch =
    activeProject !== null &&
    isScratchProject(activeProject, scratchWorkspaceRootFor(activeProject.environmentId));
  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );
  const controls = resolveContextRowControls({
    isGitRepo,
    isScratch,
    showEnvironmentIndicator: shouldShowEnvironmentIndicator({
      activeEnvironment:
        availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
      canPickEnvironment: showEnvironmentPicker,
    }),
  });
  const showEnvironmentIndicator = controls.environment;
  const showGitControls = controls.git;

  useImperativeHandle(
    ref,
    () => ({
      openBranchPicker: () => branchSelectorRef.current?.open(),
      usePreviousWorktree: () => {
        if (!showGitControls || !canUsePreviousWorktree || !previousWorktreeSeed) return;
        onUsePreviousWorktree();
        onComposerFocusRequest?.();
      },
    }),
    [
      canUsePreviousWorktree,
      onComposerFocusRequest,
      onUsePreviousWorktree,
      previousWorktreeSeed,
      showGitControls,
    ],
  );

  if (
    (serverThread === null && draftThread === null) ||
    !activeProject ||
    !hasContextRowControls(controls)
  ) {
    return null;
  }

  return (
    <div
      // V1's context bar spacing.
      className="flex w-full min-w-0 items-center justify-between gap-2 ps-3 pe-4 pt-1 pb-1"
      data-composer-context-row=""
    >
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <div className={CONTEXT_ROW_QUIET_CONTROLS_CLASS} data-context-row-workspace="">
          {showEnvironmentIndicator && availableEnvironments ? (
            <>
              <BranchToolbarEnvironmentSelector
                autoEnvironmentLabel={autoEnvironmentLabel}
                onAutoEnvironment={onAutoEnvironment}
                envLocked={envLocked}
                environmentId={environmentId}
                availableEnvironments={availableEnvironments}
                {...(showEnvironmentPicker && onEnvironmentChange ? { onEnvironmentChange } : {})}
              />
              {showGitControls ? <ContextRowSeparator /> : null}
            </>
          ) : null}
          {showGitControls ? (
            <>
              <BranchToolbarEnvModeSelector
                forceNewWorktree={forceNewWorktree}
                envLocked={envModeLocked}
                effectiveEnvMode={effectiveEnvMode}
                activeWorktreePath={activeWorktreePath}
                onEnvModeChange={onEnvModeChange}
                previousWorktreeLabel={previousWorktreeLabel}
                previousWorktreeBranch={previousWorktreeSeed?.branch ?? null}
                onUsePreviousWorktree={onUsePreviousWorktree}
              />
              <ContextRowSeparator />
              <BranchToolbarBranchSelector
                forceNewWorktree={forceNewWorktree}
                ref={branchSelectorRef}
                className="min-w-0"
                showPullRequestBadge={false}
                environmentId={environmentId}
                threadId={threadId}
                {...(draftId ? { draftId } : {})}
                envLocked={envLocked}
                effectiveEnvModeOverride={effectiveEnvMode}
                {...(activeThreadBranchOverride !== undefined
                  ? { activeThreadBranchOverride }
                  : {})}
                {...(onActiveThreadBranchOverrideChange
                  ? { onActiveThreadBranchOverrideChange }
                  : {})}
                startFromOrigin={startFromOrigin}
                onStartFromOriginChange={onStartFromOriginChange}
                {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
                {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
});
