import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { PanelRightIcon, SquareMenuIcon } from "lucide-react";
import { type Ref, memo, useCallback, useImperativeHandle, useMemo, useRef } from "react";

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
import { PopoverTrigger, type PopoverCreateHandle } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import type { ThreadPanelPresentation } from "../rightPanelLayout";
import { useScratchProject } from "../hooks/useScratchProject";
import { cn } from "../lib/utils";
import {
  useProject,
  useProjects,
  useThreadShell,
  useThreadShellsForProjectRefs,
} from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { ComposerContextProjects } from "./ComposerContextProjects";
import {
  resolveLinkableProjects,
  resolveLinkedProjects,
  resolveProjectChoiceEffect,
} from "./contextRowProjects";
import {
  CONTEXT_ROW_QUIET_CONTROLS_CLASS,
  CONTEXT_ROW_SEPARATOR_CLASS,
  CONTEXT_ROW_TOGGLE_CLASS,
} from "./contextRowStyles";
import { useRetargetDraftToProject } from "./useRetargetDraftToProject";

const EMPTY_PROJECT_IDS: ReadonlyArray<string> = [];

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
  rightPanelOpen: boolean;
  rightPanelAvailable: boolean;
  rightPanelShortcutLabel: string | null;
  onToggleRightPanel: () => void;
  /** Upstream's thread details toggle, as ChatView hands it to its header controls. */
  threadPanel: ThreadPanelToggleProps;
}

export interface ThreadPanelToggleProps {
  open: boolean;
  presentation: ThreadPanelPresentation;
  popoverHandle: ReturnType<typeof PopoverCreateHandle>;
  shortcutLabel: string | null;
  hasAttention: boolean;
  onToggle: () => void;
}

function ContextRowSlash() {
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

function ContextRowSeparator() {
  return <span aria-hidden="true" className={CONTEXT_ROW_SEPARATOR_CLASS} />;
}

/** V1's right-panel toggle at the row's right edge; the header no longer shows one. */
function RightPanelToggle(props: {
  open: boolean;
  available: boolean;
  shortcutLabel: string | null;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <button
          type="button"
          aria-label="Toggle right panel"
          aria-pressed={props.open}
          disabled={!props.available}
          className={CONTEXT_ROW_TOGGLE_CLASS}
          onClick={props.onToggle}
          data-context-row-panel-toggle=""
        >
          <PanelRightIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {props.available
          ? `Toggle right panel${props.shortcutLabel ? ` (${props.shortcutLabel})` : ""}`
          : "Right panel is unavailable"}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * Upstream's "Toggle thread details panel" (`PanelLayoutControls`), moved from
 * the header into the row and drawn like its other icons. As upstream's: a
 * popover trigger while the card is a popover, a toggle while it is inline.
 */
function ThreadPanelToggle(props: ThreadPanelToggleProps) {
  const popover = props.presentation === "popover";
  const button = (
    <button
      type="button"
      aria-label="Toggle thread details panel"
      aria-pressed={props.open}
      className={cn(CONTEXT_ROW_TOGGLE_CLASS, "relative")}
      onClick={popover ? undefined : props.onToggle}
      data-context-row-thread-panel-toggle=""
    >
      <SquareMenuIcon className="size-4" />
      {props.hasAttention ? (
        <span
          className="absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-background"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={popover ? <PopoverTrigger handle={props.popoverHandle} render={button} /> : button}
      />
      <TooltipPopup side="top">
        Toggle thread details
        {props.shortcutLabel ? ` (${props.shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The row under the composer, as V1 had it: the chat's projects and `+`, then
 * `/` upstream's checkout mode, `|` upstream's branch, and the right-panel
 * toggle at the right. The workspace state and actions are upstream's
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
  rightPanelOpen,
  rightPanelAvailable,
  rightPanelShortcutLabel,
  onToggleRightPanel,
  threadPanel,
}: UpComputerComposerContextRowProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
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
  const projects = useProjects();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  const retargetDraft = useRetargetDraftToProject();

  // The workspace state, decided as upstream's BranchToolbar decides it.
  const activeWorktreePath = forceNewWorktree
    ? null
    : (serverThread?.worktreePath ?? draftThread?.worktreePath ?? null);
  const effectiveEnvMode = forceNewWorktree ? "worktree" : envMode;
  const envModeLocked = envLocked || (serverThread !== null && activeWorktreePath !== null);
  const canUsePreviousWorktree =
    draftThread !== null && serverThread === null && !envModeLocked && !forceNewWorktree;
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
    setDraftThreadContext(draftId ?? threadRef, {
      branch: previousWorktreeSeed.branch,
      worktreePath: previousWorktreeSeed.worktreePath,
      envMode: "worktree",
      projectRef: activeProjectRef,
    });
  }, [activeProjectRef, draftId, previousWorktreeSeed, setDraftThreadContext, threadRef]);

  const isScratch =
    activeProject !== null &&
    isScratchProject(activeProject, scratchWorkspaceRootFor(activeProject.environmentId));
  const showGitControls = isGitRepo && !isScratch;

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

  const linkedProjectIds = serverThread?.linkedProjectIds ?? EMPTY_PROJECT_IDS;
  const linkedProjects = useMemo(
    () =>
      activeProject
        ? resolveLinkedProjects({
            projects,
            environmentId,
            ownProjectId: activeProject.id,
            linkedProjectIds,
          })
        : [],
    [activeProject, environmentId, linkedProjectIds, projects],
  );
  const scratchRoot = scratchWorkspaceRootFor(environmentId);
  const linkableProjects = useMemo(
    () =>
      resolveLinkableProjects({
        projects,
        environmentId,
        excludedProjectIds: [
          ...(activeProject ? [activeProject.id] : []),
          ...linkedProjects.map((project) => project.id),
        ],
        isScratchProject: (project) => isScratchProject(project, scratchRoot),
      }),
    [activeProject, environmentId, linkedProjects, projects, scratchRoot],
  );
  const choiceEffect = resolveProjectChoiceEffect({
    isServerThread: serverThread !== null,
    isScratch,
  });
  const onChooseProject = useCallback(
    (project: EnvironmentProject) => {
      if (choiceEffect === "link") {
        void updateMetadata({
          environmentId,
          input: { threadId, linkProjectIds: [project.id] },
        });
      } else if (choiceEffect === "retarget" && draftId) {
        retargetDraft(draftId, project);
      }
    },
    [choiceEffect, draftId, environmentId, retargetDraft, threadId, updateMetadata],
  );
  const onUnlinkProject = useCallback(
    (project: EnvironmentProject) => {
      void updateMetadata({
        environmentId,
        input: { threadId, unlinkProjectIds: [project.id] },
      });
    },
    [environmentId, threadId, updateMetadata],
  );

  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );
  const showEnvironmentIndicator =
    !isScratch &&
    shouldShowEnvironmentIndicator({
      activeEnvironment:
        availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
      canPickEnvironment: showEnvironmentPicker,
    });

  if ((serverThread === null && draftThread === null) || !activeProject) return null;

  return (
    <div
      // V1's context bar spacing.
      className="flex w-full min-w-0 items-center justify-between gap-2 ps-3 pe-4 pt-1 pb-1"
      data-composer-context-row=""
    >
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <ComposerContextProjects
          ownProject={isScratch ? null : activeProject}
          linkedProjects={linkedProjects}
          linkableProjects={linkableProjects}
          onChooseProject={choiceEffect === null ? null : onChooseProject}
          onUnlinkProject={onUnlinkProject}
        />
        {showEnvironmentIndicator || showGitControls ? <ContextRowSlash /> : null}
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
      <div className="flex shrink-0 items-center">
        <ThreadPanelToggle {...threadPanel} />
        <RightPanelToggle
          open={rightPanelOpen}
          available={rightPanelAvailable}
          shortcutLabel={rightPanelShortcutLabel}
          onToggle={onToggleRightPanel}
        />
      </div>
    </div>
  );
});
