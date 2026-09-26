import { SidebarThreadAccessory } from "./sidebar/SidebarThreadAccessory";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  CloudIcon,
  ContainerIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ThreadStatusLabel } from "./ThreadStatusIndicators";
import * as Schema from "effect/Schema";

import { ProjectFavicon } from "./ProjectFavicon";
import { waitForServerThreadShell } from "./ChatView.logic";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { PROJECT_STATUS_INDICATOR_EXPERIMENT_KEY } from "./sidebar/experiments";
import { useAtomValue } from "@effect/atom-react";
import { autoAnimate } from "@formkit/auto-animate";
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_SERVER_SETTINGS,
  type ContextMenuItem,
  ProjectId,
  type ScopedThreadRef,
  type ResolvedKeybindingsConfig,
  type SidebarProjectGroupingMode,
  ThreadId,
} from "@upcomputer/contracts";
import {
  parseScopedThreadKey,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@upcomputer/client-runtime/environment";
import { safeErrorLogAttributes } from "@upcomputer/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@upcomputer/client-runtime/state/runtime";
import { useLocation, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { truncate } from "@upcomputer/shared/String";
import type {
  SidebarThreadPreviewCount,
  SidebarThreadSortOrder,
  SidebarViewMode,
} from "@upcomputer/contracts/settings";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useDesktopLocalBootstraps } from "../connection/useDesktopLocalBootstraps";
import { isElectron } from "../env";
import { cn, isMacPlatform, newThreadId } from "../lib/utils";
import {
  readThreadShell,
  useProjects,
  useServerConfigs,
  useThreadShells,
  useThreadShellsForProjectRefs,
} from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  useUiStateStore,
} from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { useShortcutModifierState } from "../shortcutModifierState";
import { readLocalApi } from "../localApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useDesktopUpdateState } from "../state/desktopUpdate";

import { useThreadActions } from "../hooks/useThreadActions";
import { projectEnvironment } from "../state/projects";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import { useEnvironment, useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { openCommandPalette } from "../commandPaletteBus";
import {
  archiveSelectedThreadEntries,
  buildMultiSelectThreadContextMenuItems,
  buildThreadContextMenuItems,
  getSidebarThreadIdsToPrewarm,
  partitionSnoozedThreads,
  resolveThreadSnoozeMenuState,
  snoozedUntilFromMenuAction,
  formatSidebarThreadTimestamp,
  resolveAdjacentThreadId,
  isContextMenuPointerDown,
  isTrailingDoubleClick,
  resolveSidebarNewThreadSeedContext,
  resolveSidebarNewThreadEnvMode,
  resolveThreadCompletionTimestamp,
  resolveProjectStatusIndicator,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  orderItemsByPreferredIds,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  useThreadJumpHintVisibility,
} from "./Sidebar.logic";
import { sortThreads } from "../lib/threadSort";
import { snoozeWakeLabel } from "./Sidebar.snooze";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { CommandDialogTrigger } from "./ui/command";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  derivePhysicalProjectKey,
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import type { SidebarThreadSummary } from "../types";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { WebFeatureNavigationItems } from "./product/WebFeatureNavigation";
import {
  SIDEBAR_LABEL_COLOR_CLASS,
  SIDEBAR_LABEL_TEXT_CLASS,
  SIDEBAR_MUTED_TEXT_CLASS,
} from "./sidebar/sidebarTextStyles";
import { resolveAvailableSidebarViewMode } from "./sidebar/sidebarViewMode";
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();
const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};
function SidebarThreadDetailPrewarmer({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  useEnvironmentThread(threadRef.environmentId, threadRef.threadId);
  return null;
}

function formatProjectMemberActionLabel(
  member: SidebarProjectGroupMember,
  groupedProjectCount: number,
): string {
  if (groupedProjectCount <= 1) {
    return member.title;
  }

  return member.environmentLabel
    ? `${member.environmentLabel} — ${member.workspaceRoot}`
    : member.workspaceRoot;
}

function projectExpansionPreferenceKeys(project: SidebarProjectSnapshot): string[] {
  return [
    project.projectKey,
    ...project.memberProjects.map((member) => member.physicalProjectKey),
    ...project.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Projects from the same repository share one sidebar row.";
    case "repository_path":
      return "Projects group only when both the repository and repo-relative path match.";
    case "separate":
      return "Every project path gets its own sidebar row.";
  }
}

function buildThreadJumpLabelMap(input: {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  threadJumpCommandByKey: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<string, string> {
  if (input.threadJumpCommandByKey.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = { platform: input.platform } as const;
  const mapping = new Map<string, string>();
  for (const [threadKey, command] of input.threadJumpCommandByKey) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(threadKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}

/**
 * Snooze classification against a real clock. Re-renders when the next
 * snoozed thread's wake time passes so it returns to its normal place;
 * early wakes (a raised hand, "Wake now") arrive as shell updates.
 */
function useIsThreadSnoozed(
  threads: readonly SidebarThreadSummary[],
): (thread: SidebarThreadSummary) => boolean {
  const serverConfigs = useServerConfigs();
  const [wakeTick, setWakeTick] = useState(0);
  const isThreadSnoozed = useMemo(() => {
    void wakeTick;
    const now = new Date();
    return (thread: SidebarThreadSummary) =>
      resolveThreadSnoozeMenuState({
        thread,
        supportsSnooze:
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true,
        now,
      }) === "snoozed";
  }, [serverConfigs, wakeTick]);
  const nextWakeAtMs = useMemo(() => {
    let next: number | null = null;
    for (const thread of threads) {
      if (!isThreadSnoozed(thread)) continue;
      const wakeAtMs = Date.parse(thread.snoozedUntil ?? "");
      if (next === null || wakeAtMs < next) next = wakeAtMs;
    }
    return next;
  }, [isThreadSnoozed, threads]);
  useEffect(() => {
    if (nextWakeAtMs === null) return;
    const id = window.setTimeout(
      () => setWakeTick((tick) => tick + 1),
      Math.min(Math.max(0, nextWakeAtMs - Date.now()) + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
  }, [nextWakeAtMs]);
  return isThreadSnoozed;
}

interface SidebarThreadRowProps {
  thread: SidebarThreadSummary;
  orderedProjectThreadKeys: readonly string[];
  isActive: boolean;
  jumpLabel: string | null;
  contentClassName?: string | undefined;
  /** Wake countdown shown instead of the timestamp for rows in the Snoozed group. */
  wakeLabel?: string | undefined;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  startThreadRename: (threadKey: string, title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
}

export const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const {
    orderedProjectThreadKeys,
    isActive,
    jumpLabel,
    contentClassName,
    wakeLabel,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    startThreadRename,
    renamingInputRef,
    renamingCommittedRef,
    handleThreadClick,
    navigateToThread,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    thread,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const isMobile = useIsMobile();
  const environment = useEnvironment(thread.environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isRemoteThread =
    primaryEnvironmentId !== null && thread.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = environment?.label ?? null;
  // A desktop-local secondary backend (e.g. the WSL backend) shows up as a
  // bearer environment whose connection id is prefixed "local:". It runs on the
  // user's own machine, so the cloud icon is misleading — label it "Local" and
  // suppress the cloud icon (the project header already shows a container icon
  // for desktop-local projects, see sidebarProjectGrouping).
  const isDesktopLocalThread =
    environment !== null && isDesktopLocalConnectionTarget(environment.entry.target);
  const threadEnvironmentLabel = isRemoteThread
    ? (remoteEnvLabel ?? (isDesktopLocalThread ? "Local" : "Remote"))
    : null;
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      handleThreadClick(event, threadRef, orderedProjectThreadKeys);
    },
    [handleThreadClick, orderedProjectThreadKeys, threadRef],
  );
  const handleRowDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Already renaming this row: a double-click on the row chrome (outside the
      // input) must not restart and discard the in-progress edit.
      if (renamingThreadKey === threadKey) return;
      // On mobile the first tap navigates and closes the sidebar sheet, so the
      // inline rename can't be shown. Renaming there stays on the context menu.
      if (isMobile) return;
      // cmd/ctrl/shift double-clicks are multi-select intent, not rename.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // Ignore double-clicks bubbling from nested controls (PR status, port,
      // archive buttons) — only the row body should enter inline rename.
      if ((event.target as HTMLElement).closest("button, a")) return;
      event.preventDefault();
      startThreadRename(threadKey, thread.title);
    },
    [isMobile, renamingThreadKey, startThreadRename, threadKey, thread.title],
  );
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigateToThread(threadRef);
    },
    [navigateToThread, threadRef],
  );
  // Right-click and the "…" button open the same menu: the multi-select menu
  // on a selected row, otherwise this thread's menu.
  const openRowMenu = useCallback(
    (position: { x: number; y: number }) => {
      const hasSelection = useThreadSelectionStore.getState().hasSelection();
      const showMenu = () =>
        hasSelection && isSelected
          ? handleMultiSelectContextMenu(position)
          : handleThreadContextMenu(threadRef, position);
      if (hasSelection && !isSelected) {
        clearSelection();
      }
      void (async () => {
        const result = await settlePromise(showMenu);
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Thread action failed",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [clearSelection, handleMultiSelectContextMenu, handleThreadContextMenu, isSelected, threadRef],
  );
  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      openRowMenu({ x: event.clientX, y: event.clientY });
    },
    [openRowMenu],
  );
  const handleMoreButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openRowMenu({ x: rect.left, y: rect.bottom + 4 });
    },
    [openRowMenu],
  );
  const handleRenameInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && renamingInputRef.current !== element) {
        renamingInputRef.current = element;
        element.focus();
        element.select();
      }
    },
    [renamingInputRef],
  );
  const handleRenameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );
  const handleRenameInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef],
  );
  const handleRenameInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(threadRef, renamingTitle, thread.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef]);
  // Keep clicks/double-clicks inside the rename input from bubbling to the row.
  // Without stopping `dblclick`, double-clicking to select a word would re-fire
  // the row's rename handler and reset the in-progress edit back to the title.
  const handleRenameInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);
  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const rowButtonRender = useMemo(() => <div role="button" tabIndex={0} />, []);

  return (
    <SidebarMenuSubItem className="w-full" data-thread-item>
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={isActive}
        data-testid={`thread-row-${thread.id}`}
        className={`${resolveThreadRowClassName({
          isActive,
          isSelected,
        })} relative isolate`}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
      >
        <div
          className={cn(
            "ml-6 flex min-w-0 flex-1 items-center gap-1.5 text-left",
            contentClassName,
          )}
        >
          {threadStatus && <ThreadStatusLabel status={threadStatus} showDot={false} />}
          {renamingThreadKey === threadKey ? (
            <input
              ref={handleRenameInputRef}
              className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-sm outline-none"
              value={renamingTitle}
              onChange={handleRenameInputChange}
              onKeyDown={handleRenameInputKeyDown}
              onBlur={handleRenameInputBlur}
              onClick={handleRenameInputClick}
              onDoubleClick={handleRenameInputClick}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      SIDEBAR_LABEL_COLOR_CLASS,
                      SIDEBAR_LABEL_TEXT_CLASS,
                    )}
                    data-testid={`thread-title-${thread.id}`}
                  >
                    {thread.title}
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
                {thread.title}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div
            className={`flex min-w-fit justify-end ${
              isRemoteThread ? "max-sm:min-w-24" : "max-sm:min-w-20"
            }`}
          >
            <div className="pointer-events-none absolute inset-y-0 right-2 my-auto flex size-5 items-center justify-center opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
              <button
                type="button"
                data-thread-selection-safe
                data-testid={`thread-actions-${thread.id}`}
                aria-label={`Thread actions for ${thread.title}`}
                className={cn(
                  "flex size-5 cursor-pointer items-center justify-center transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:hover:text-white/86",
                  SIDEBAR_MUTED_TEXT_CLASS,
                )}
                onPointerDown={stopPropagationOnPointerDown}
                onClick={handleMoreButtonClick}
              >
                <MoreHorizontalIcon className="block size-4" />
              </button>
            </div>
            <span className="pointer-events-none transition-opacity duration-150 max-sm:pr-6 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0">
              <span className="inline-flex items-center gap-1">
                {isRemoteThread && !isDesktopLocalThread && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={threadEnvironmentLabel ?? "Remote"}
                          className="inline-flex items-center justify-center"
                        />
                      }
                    >
                      <CloudIcon className="size-3 text-muted-foreground/40" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{threadEnvironmentLabel}</TooltipPopup>
                  </Tooltip>
                )}
                {jumpLabel ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={jumpLabel}
                          className="inline-flex h-6 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-sm font-medium tracking-tight text-foreground shadow-sm"
                        />
                      }
                    >
                      {jumpLabel}
                    </TooltipTrigger>
                    <TooltipPopup side="top">{jumpLabel}</TooltipPopup>
                  </Tooltip>
                ) : wakeLabel !== undefined ? (
                  <span className={cn(SIDEBAR_MUTED_TEXT_CLASS, SIDEBAR_LABEL_TEXT_CLASS)}>
                    {wakeLabel}
                  </span>
                ) : (
                  <span className={cn(SIDEBAR_MUTED_TEXT_CLASS, SIDEBAR_LABEL_TEXT_CLASS)}>
                    <SidebarThreadAccessory
                      environmentId={thread.environmentId}
                      threadId={thread.id}
                      timeLabel={formatSidebarThreadTimestamp(
                        thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                      )}
                      fallback={formatSidebarThreadTimestamp(
                        thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                      )}
                    />
                  </span>
                )}
              </span>
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

interface SidebarProjectThreadListProps {
  projectKey: string;
  projectExpanded: boolean;
  hasOverflowingThreads: boolean;
  orderedProjectThreadKeys: readonly string[];
  renderedThreads: readonly SidebarThreadSummary[];
  snoozedThreads: readonly SidebarThreadSummary[];
  snoozedExpanded: boolean;
  toggleSnoozedExpanded: () => void;
  showEmptyThreadState: boolean;
  shouldShowThreadPanel: boolean;
  isThreadListExpanded: boolean;
  activeRouteThreadKey: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  threadContentClassName?: string | undefined;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  startThreadRename: (threadKey: string, title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
}

const SidebarProjectThreadList = memo(function SidebarProjectThreadList(
  props: SidebarProjectThreadListProps,
) {
  const {
    projectKey,
    projectExpanded,
    hasOverflowingThreads,
    orderedProjectThreadKeys,
    renderedThreads,
    snoozedThreads,
    snoozedExpanded,
    toggleSnoozedExpanded,
    showEmptyThreadState,
    shouldShowThreadPanel,
    isThreadListExpanded,
    activeRouteThreadKey,
    threadJumpLabelByKey,
    threadContentClassName,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    startThreadRename,
    renamingInputRef,
    renamingCommittedRef,
    attachThreadListAutoAnimateRef,
    handleThreadClick,
    navigateToThread,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    expandThreadListForProject,
    collapseThreadListForProject,
  } = props;
  const showMoreButtonRender = useMemo(() => <button type="button" />, []);
  const showLessButtonRender = useMemo(() => <button type="button" />, []);
  const snoozedToggleButtonRender = useMemo(() => <button type="button" />, []);
  const threadAuxiliaryContentClassName = cn("ml-6", threadContentClassName);
  const snoozedThreadKeys = useMemo(
    () =>
      snoozedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [snoozedThreads],
  );
  const renderThreadRow = (
    thread: SidebarThreadSummary,
    rowOrderedThreadKeys: readonly string[],
    wakeLabel?: string,
  ) => {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    return (
      <SidebarThreadRow
        key={threadKey}
        thread={thread}
        orderedProjectThreadKeys={rowOrderedThreadKeys}
        isActive={activeRouteThreadKey === threadKey}
        jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
        contentClassName={threadContentClassName}
        wakeLabel={wakeLabel}
        renamingThreadKey={renamingThreadKey}
        renamingTitle={renamingTitle}
        setRenamingTitle={setRenamingTitle}
        startThreadRename={startThreadRename}
        renamingInputRef={renamingInputRef}
        renamingCommittedRef={renamingCommittedRef}
        handleThreadClick={handleThreadClick}
        navigateToThread={navigateToThread}
        handleMultiSelectContextMenu={handleMultiSelectContextMenu}
        handleThreadContextMenu={handleThreadContextMenu}
        clearSelection={clearSelection}
        commitRename={commitRename}
        cancelRename={cancelRename}
      />
    );
  };

  return (
    <SidebarMenuSub ref={attachThreadListAutoAnimateRef} className="mt-0.5 mb-0 w-full">
      {shouldShowThreadPanel && showEmptyThreadState ? (
        <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
          <div
            data-thread-selection-safe
            className={cn(
              "flex h-8 w-full translate-x-0 items-center px-2 text-left",
              SIDEBAR_MUTED_TEXT_CLASS,
              SIDEBAR_LABEL_TEXT_CLASS,
            )}
          >
            <span className={threadAuxiliaryContentClassName}>No threads yet</span>
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {shouldShowThreadPanel &&
        renderedThreads.map((thread) => renderThreadRow(thread, orderedProjectThreadKeys))}

      {projectExpanded && hasOverflowingThreads && !isThreadListExpanded && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showMoreButtonRender}
            data-thread-selection-safe
            size="sm"
            className={cn(
              "h-8 w-full translate-x-0 justify-start px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              SIDEBAR_MUTED_TEXT_CLASS,
              SIDEBAR_LABEL_TEXT_CLASS,
            )}
            onClick={() => {
              expandThreadListForProject(projectKey);
            }}
          >
            <span className={threadAuxiliaryContentClassName}>Show more</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded && hasOverflowingThreads && isThreadListExpanded && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showLessButtonRender}
            data-thread-selection-safe
            size="sm"
            className={cn(
              "h-8 w-full translate-x-0 justify-start px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              SIDEBAR_MUTED_TEXT_CLASS,
              SIDEBAR_LABEL_TEXT_CLASS,
            )}
            onClick={() => {
              collapseThreadListForProject(projectKey);
            }}
          >
            <span className={threadAuxiliaryContentClassName}>Show less</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded && snoozedThreads.length > 0 && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={snoozedToggleButtonRender}
            data-thread-selection-safe
            size="sm"
            aria-expanded={snoozedExpanded}
            className={cn(
              "h-8 w-full translate-x-0 justify-start px-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              SIDEBAR_MUTED_TEXT_CLASS,
              SIDEBAR_LABEL_TEXT_CLASS,
            )}
            onClick={toggleSnoozedExpanded}
          >
            <span className={cn("flex items-center gap-1", threadAuxiliaryContentClassName)}>
              Snoozed ({snoozedThreads.length})
              <ChevronRightIcon
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-150",
                  snoozedExpanded && "rotate-90",
                )}
              />
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded &&
        snoozedExpanded &&
        snoozedThreads.map((thread) =>
          renderThreadRow(
            thread,
            snoozedThreadKeys,
            snoozeWakeLabel(thread.snoozedUntil ?? "", new Date()),
          ),
        )}
    </SidebarMenuSub>
  );
});

interface SidebarProjectItemProps {
  project: SidebarProjectSnapshot;
  isThreadListExpanded: boolean;
  activeRouteThreadKey: string | null;
  newThreadShortcutLabel: string | null;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  snoozeThread: ReturnType<typeof useThreadActions>["snoozeThread"];
  unsnoozeThread: ReturnType<typeof useThreadActions>["unsnoozeThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  isManualProjectSorting: boolean;
  dragHandleProps: SortableProjectHandleProps | null;
  hideProjectHeader?: boolean;
  projectExpandedOverride?: boolean;
  threadContentClassName?: string;
  threadPreviewLimit?: number;
}

const SidebarProjectItem = memo(function SidebarProjectItem(props: SidebarProjectItemProps) {
  const serverConfigs = useServerConfigs();
  const {
    project,
    isThreadListExpanded,
    activeRouteThreadKey,
    newThreadShortcutLabel,
    handleNewThread,
    archiveThread,
    deleteThread,
    snoozeThread,
    unsnoozeThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    isManualProjectSorting,
    dragHandleProps,
    hideProjectHeader = false,
    projectExpandedOverride,
    threadContentClassName,
    threadPreviewLimit,
  } = props;
  const threadSortOrder = useClientSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const appSettingsConfirmThreadDelete = useClientSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const deleteProject = useAtomCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const forkThreadContext = useAtomCommand(threadEnvironment.forkContext, {
    reportFailure: false,
  });
  const updateSettings = useUpdateClientSettings();
  const sidebarThreadPreviewCount = useClientSettings<SidebarThreadPreviewCount>(
    (settings) => settings.sidebarThreadPreviewCount,
  );
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const sidebarThreads = useThreadShellsForProjectRefs(project.memberProjectRefs);
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Keep a ref so callbacks can read the latest map without appearing in
  // dependency arrays (avoids invalidating every thread-row memo on each
  // thread-list change).
  const sidebarThreadByKeyRef = useRef(sidebarThreadByKey);
  sidebarThreadByKeyRef.current = sidebarThreadByKey;
  const projectThreads = sidebarThreads;
  const projectPreferenceKeys = useMemo(() => projectExpansionPreferenceKeys(project), [project]);
  const storedProjectExpanded = useUiStateStore((state) =>
    resolveProjectExpanded(state.projectExpandedById, projectPreferenceKeys),
  );
  const projectExpanded = projectExpandedOverride ?? storedProjectExpanded;
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [snoozedExpanded, setSnoozedExpanded] = useState(false);
  const toggleSnoozedExpanded = useCallback(() => setSnoozedExpanded((expanded) => !expanded), []);
  const [projectRenameTarget, setProjectRenameTarget] = useState<SidebarProjectGroupMember | null>(
    null,
  );
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [projectGroupingTarget, setProjectGroupingTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const memberProjectByScopedKey = useMemo(
    () =>
      new Map(
        project.memberProjects.map((member) => [
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          member,
        ]),
      ),
    [project.memberProjects],
  );
  const memberThreadCountByPhysicalKey = useMemo(() => {
    const counts = new Map<string, number>(
      project.memberProjects.map((member) => [member.physicalProjectKey, 0] as const),
    );
    for (const thread of projectThreads) {
      const member = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (!member) {
        continue;
      }
      counts.set(member.physicalProjectKey, (counts.get(member.physicalProjectKey) ?? 0) + 1);
    }
    return counts;
  }, [memberProjectByScopedKey, project.memberProjects, projectThreads]);

  const [projectStatusIndicatorEnabled] = useLocalStorage(
    PROJECT_STATUS_INDICATOR_EXPERIMENT_KEY,
    false,
    Schema.Boolean,
  );
  const isThreadSnoozed = useIsThreadSnoozed(projectThreads);
  const { visibleProjectThreads, snoozedThreads, orderedProjectThreadKeys, projectStatus } =
    useMemo(() => {
      const { active, snoozed } = partitionSnoozedThreads(
        projectThreads.filter((thread) => thread.archivedAt === null),
        isThreadSnoozed,
      );
      const visibleProjectThreads = sortThreads(active, threadSortOrder);
      return {
        snoozedThreads: snoozed,
        orderedProjectThreadKeys: visibleProjectThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
        // Highest-priority thread status in the project, for the collapsed-row
        // dot. Unlike upstream this ignores per-thread `lastVisitedAt`, which
        // this component does not have -- it only shifts the "unread" flavour,
        // not the Working / Awaiting Input / Pending Approval states the dot is
        // actually there to surface.
        projectStatus: resolveProjectStatusIndicator(
          visibleProjectThreads.map((thread) => resolveThreadStatusPill({ thread })),
        ),
        visibleProjectThreads,
      };
    }, [isThreadSnoozed, projectThreads, threadSortOrder]);
  const pinnedCollapsedThread = useMemo(() => {
    const activeThreadKey = activeRouteThreadKey ?? undefined;
    if (!activeThreadKey || projectExpanded) {
      return null;
    }
    return (
      visibleProjectThreads.find(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeThreadKey,
      ) ?? null
    );
  }, [activeRouteThreadKey, projectExpanded, visibleProjectThreads]);

  const { hasOverflowingThreads, renderedThreads, showEmptyThreadState, shouldShowThreadPanel } =
    useMemo(() => {
      const resolvedThreadPreviewCount = threadPreviewLimit ?? sidebarThreadPreviewCount;
      const hasOverflowingThreads = visibleProjectThreads.length > resolvedThreadPreviewCount;
      const previewThreads =
        isThreadListExpanded || !hasOverflowingThreads
          ? visibleProjectThreads
          : visibleProjectThreads.slice(0, resolvedThreadPreviewCount);
      const visibleThreadKeys = new Set(
        [...previewThreads, ...(pinnedCollapsedThread ? [pinnedCollapsedThread] : [])].map(
          (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
      const renderedThreads = pinnedCollapsedThread
        ? [pinnedCollapsedThread]
        : visibleProjectThreads.filter((thread) =>
            visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
          );
      return {
        hasOverflowingThreads,
        renderedThreads,
        showEmptyThreadState:
          projectExpanded && visibleProjectThreads.length === 0 && snoozedThreads.length === 0,
        shouldShowThreadPanel: projectExpanded || pinnedCollapsedThread !== null,
      };
    }, [
      isThreadListExpanded,
      pinnedCollapsedThread,
      projectExpanded,
      sidebarThreadPreviewCount,
      snoozedThreads.length,
      threadPreviewLimit,
      visibleProjectThreads,
    ]);

  const handleProjectButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (useThreadSelectionStore.getState().hasSelection()) {
        clearSelection();
      }
      setProjectExpanded(projectPreferenceKeys, !projectExpanded);
    },
    [
      clearSelection,
      dragInProgressRef,
      projectExpanded,
      projectPreferenceKeys,
      setProjectExpanded,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
    ],
  );

  const handleProjectButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      setProjectExpanded(projectPreferenceKeys, !projectExpanded);
    },
    [dragInProgressRef, projectExpanded, projectPreferenceKeys, setProjectExpanded],
  );

  const handleProjectButtonPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef],
  );

  const openProjectRenameDialog = useCallback((member: SidebarProjectGroupMember) => {
    setProjectRenameTarget(member);
    setProjectRenameTitle(member.title);
  }, []);

  const openProjectGroupingDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      setProjectGroupingTarget(member);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const removeProject = useCallback(
    async (member: SidebarProjectGroupMember, options: { force?: boolean } = {}) => {
      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const result = await deleteProject({
        environmentId: member.environmentId,
        input: {
          projectId: member.id,
          ...(options.force === true ? { force: true } : {}),
        },
      });
      if (result._tag === "Failure") {
        return result;
      }
      const draftStore = useComposerDraftStore.getState();
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(memberProjectRef);
      if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(memberProjectRef);
      return result;
    },
    [deleteProject],
  );

  const handleRemoveProject = useCallback(
    async (member: SidebarProjectGroupMember) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }

      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const memberThreadCount = memberThreadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
      if (memberThreadCount > 0) {
        const warningToastId = toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Project is not empty",
            description: "Delete all threads in this project before removing it.",
            actionVariant: "destructive",
            actionProps: {
              children: "Delete anyway",
              onClick: () => {
                void (async () => {
                  toastManager.close(warningToastId);
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 180);
                  });

                  const latestProjectThreads = Array.from(
                    sidebarThreadByKeyRef.current.values(),
                  ).filter(
                    (thread) =>
                      thread.environmentId === memberProjectRef.environmentId &&
                      thread.projectId === memberProjectRef.projectId,
                  );
                  const confirmed = await api.dialogs.confirm(
                    latestProjectThreads.length > 0
                      ? [
                          `Remove project "${member.title}" and delete its ${latestProjectThreads.length} thread${
                            latestProjectThreads.length === 1 ? "" : "s"
                          }?`,
                          `Path: ${member.workspaceRoot}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This permanently clears conversation history for those threads.",
                          "This removes only this project entry.",
                          "This action cannot be undone.",
                        ].join("\n")
                      : [
                          `Remove project "${member.title}"?`,
                          `Path: ${member.workspaceRoot}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This removes only this project entry.",
                        ].join("\n"),
                  );
                  if (!confirmed) {
                    return;
                  }

                  const result = await removeProject(member, { force: true });
                  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                    const error = squashAtomCommandFailure(result);
                    toastManager.add(
                      stackedThreadToast({
                        type: "error",
                        title: `Failed to remove "${member.title}"`,
                        description:
                          error instanceof Error
                            ? error.message
                            : "Unknown error removing project.",
                      }),
                    );
                  }
                })().catch((error) => {
                  const message =
                    error instanceof Error ? error.message : "Unknown error removing project.";
                  console.error("Failed to remove project", {
                    projectId: member.id,
                    environmentId: member.environmentId,
                    ...safeErrorLogAttributes(error),
                  });
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: `Failed to remove "${member.title}"`,
                      description: message,
                    }),
                  );
                });
              },
            },
          }),
        );
        return;
      }

      const message = [
        `Remove project "${member.title}"?`,
        `Path: ${member.workspaceRoot}`,
        ...(member.environmentLabel ? [`Environment: ${member.environmentLabel}`] : []),
        "This removes only this project entry.",
      ].join("\n");
      const confirmed = await api.dialogs.confirm(message);
      if (!confirmed) {
        return;
      }

      const result = await removeProject(member);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", {
          projectId: member.id,
          environmentId: member.environmentId,
          ...safeErrorLogAttributes(error),
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to remove "${member.title}"`,
            description: message,
          }),
        );
      }
    },
    [memberThreadCountByPhysicalKey, removeProject],
  );

  const handleProjectButtonContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressProjectClickForContextMenuRef.current = true;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const actionHandlers = new Map<string, () => Promise<void> | void>();
        const makeLeaf = (
          action: "rename" | "grouping" | "copy-path" | "delete",
          member: SidebarProjectGroupMember,
          options?: {
            destructive?: boolean;
            disabled?: boolean;
          },
        ): ContextMenuItem<string> => {
          const id = `${action}:${member.physicalProjectKey}`;
          actionHandlers.set(id, () => {
            switch (action) {
              case "rename":
                openProjectRenameDialog(member);
                return;
              case "grouping":
                openProjectGroupingDialog(member);
                return;
              case "copy-path":
                copyPathToClipboard(member.workspaceRoot, { path: member.workspaceRoot });
                return;
              case "delete":
                return handleRemoveProject(member);
            }
          });

          return {
            id,
            label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
            ...(options?.destructive ? { destructive: true } : {}),
            ...(options?.disabled ? { disabled: true } : {}),
          };
        };

        const buildTargetedItem = (
          action: "rename" | "grouping" | "copy-path" | "delete",
          label: string,
          options?: {
            destructive?: boolean;
            isDisabled?: (member: SidebarProjectGroupMember) => boolean;
          },
        ): ContextMenuItem<string> => {
          if (project.memberProjects.length === 1) {
            const singleMember = project.memberProjects[0]!;
            return {
              ...makeLeaf(action, singleMember, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(singleMember) ? { disabled: true } : {}),
              }),
              label,
              ...(action === "delete" ? { icon: "trash" } : {}),
            };
          }

          return {
            id: `${action}:submenu`,
            label,
            ...(action === "delete" ? { icon: "trash" } : {}),
            children: project.memberProjects.map((member) =>
              makeLeaf(action, member, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(member) ? { disabled: true } : {}),
              }),
            ),
          };
        };

        const clicked = await api.contextMenu.show(
          [
            buildTargetedItem("rename", "Rename"),
            buildTargetedItem("grouping", "Group into..."),
            buildTargetedItem("copy-path", "Copy Path"),
            buildTargetedItem("delete", "Remove", {
              destructive: true,
            }),
          ],
          {
            x: event.clientX,
            y: event.clientY,
          },
        );

        if (!clicked) {
          return;
        }

        await actionHandlers.get(clicked)?.();
      })();
    },
    [
      copyPathToClipboard,
      handleRemoveProject,
      openProjectGroupingDialog,
      openProjectRenameDialog,
      project.groupedProjectCount,
      project.memberProjects,
      suppressProjectClickForContextMenuRef,
    ],
  );

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const handleThreadClick = useCallback(
    (
      event: React.MouseEvent,
      threadRef: ScopedThreadRef,
      orderedProjectThreadKeys: readonly string[],
    ) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);
      const currentSelectionCount = useThreadSelectionStore.getState().selectedThreadKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedProjectThreadKeys);
        return;
      }

      // Ignore the trailing click of a plain double-click so it doesn't navigate
      // while a double-click is starting an inline rename. Placed after the
      // modifier branches so cmd/shift selection still processes every click.
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [
      clearSelection,
      isMobile,
      rangeSelectTo,
      router,
      setOpenMobile,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectedThreadEntries = threadKeys.flatMap((threadKey) => {
        const threadRef = parseScopedThreadKey(threadKey);
        const thread = threadRef ? readThreadShell(threadRef) : null;
        return threadRef && thread ? [{ threadKey, threadRef, thread }] : [];
      });
      const hasRunningThread = selectedThreadEntries.some(
        ({ thread }) => thread.session?.status === "running" && thread.session.activeTurnId != null,
      );
      const now = new Date();
      const canSnoozeSelection = selectedThreadEntries.every(
        ({ thread }) =>
          resolveThreadSnoozeMenuState({
            thread,
            supportsSnooze:
              serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze ===
              true,
            now,
          }) !== "unavailable",
      );

      const clicked = await api.contextMenu.show(
        buildMultiSelectThreadContextMenuItems({
          count,
          hasRunningThread,
          canSnooze: canSnoozeSelection,
          now,
        }),
        position,
      );

      if (clicked === "mark-unread") {
        for (const { threadKey, thread } of selectedThreadEntries) {
          markThreadUnread(threadKey, resolveThreadCompletionTimestamp(thread));
        }
        clearSelection();
        return;
      }

      const snoozedUntil = snoozedUntilFromMenuAction(clicked);
      if (snoozedUntil !== null) {
        for (const { threadRef } of selectedThreadEntries) {
          const result = await snoozeThread(threadRef, snoozedUntil);
          if (result._tag === "Failure") {
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to snooze threads",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
        }
        removeFromSelection(threadKeys);
        return;
      }

      if (clicked === "archive") {
        const archiveOutcome = await archiveSelectedThreadEntries({
          entries: selectedThreadEntries,
          archive: ({ threadRef }, onArchived) => archiveThread(threadRef, { onArchived }),
        });
        for (const failure of archiveOutcome.followupFailures) {
          if (isAtomCommandInterrupted(failure)) continue;
          const error = squashAtomCommandFailure(failure);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Thread archived, but navigation failed",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        if (archiveOutcome.mutationFailure) {
          removeFromSelection(archiveOutcome.archivedThreadKeys);
          if (!isAtomCommandInterrupted(archiveOutcome.mutationFailure)) {
            const error = squashAtomCommandFailure(archiveOutcome.mutationFailure);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to archive threads",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        removeFromSelection(threadKeys);
        return;
      }

      if (clicked !== "delete") return;

      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedThreadKeys = new Set(threadKeys);
      for (const { threadRef } of selectedThreadEntries) {
        const result = await deleteThread(threadRef, {
          deletedThreadKeys,
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to delete threads",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
      }
      removeFromSelection(threadKeys);
    },
    [
      appSettingsConfirmThreadDelete,
      archiveThread,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      serverConfigs,
      snoozeThread,
    ],
  );

  const createThreadForProjectMember = useCallback(
    (member: SidebarProjectGroupMember) => {
      const currentRouteParams =
        router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentRouteTarget = resolveThreadRouteTarget(currentRouteParams);
      const currentActiveThread =
        currentRouteTarget?.kind === "server"
          ? readThreadShell(currentRouteTarget.threadRef)
          : null;
      const draftStore = useComposerDraftStore.getState();
      const currentActiveDraftThread =
        currentRouteTarget?.kind === "server"
          ? (draftStore.getDraftThread(currentRouteTarget.threadRef) ?? null)
          : currentRouteTarget?.kind === "draft"
            ? (draftStore.getDraftSession(currentRouteTarget.draftId) ?? null)
            : null;
      const seedContext = resolveSidebarNewThreadSeedContext({
        projectId: member.id,
        defaultEnvMode: resolveSidebarNewThreadEnvMode({
          defaultEnvMode:
            serverConfigs.get(member.environmentId)?.settings.defaultThreadEnvMode ??
            DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode,
        }),
        activeThread:
          currentActiveThread && currentActiveThread.projectId === member.id
            ? {
                projectId: currentActiveThread.projectId,
                branch: currentActiveThread.branch,
                worktreePath: currentActiveThread.worktreePath,
              }
            : null,
        activeDraftThread:
          currentActiveDraftThread && currentActiveDraftThread.projectId === member.id
            ? {
                projectId: currentActiveDraftThread.projectId,
                branch: currentActiveDraftThread.branch,
                worktreePath: currentActiveDraftThread.worktreePath,
                envMode: currentActiveDraftThread.envMode,
                startFromOrigin: currentActiveDraftThread.startFromOrigin,
              }
            : null,
      });
      if (isMobile) {
        setOpenMobile(false);
      }
      void (async () => {
        const result = await settlePromise(() =>
          handleNewThread(scopeProjectRef(member.environmentId, member.id), {
            ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
            ...(seedContext.worktreePath !== undefined
              ? { worktreePath: seedContext.worktreePath }
              : {}),
            envMode: seedContext.envMode,
            ...(seedContext.startFromOrigin !== undefined
              ? { startFromOrigin: seedContext.startFromOrigin }
              : {}),
          }),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [handleNewThread, isMobile, router, serverConfigs, setOpenMobile],
  );

  const handleCreateThreadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (project.memberProjects.length === 1) {
        createThreadForProjectMember(project.memberProjects[0]!);
        return;
      }

      void (async () => {
        const api = readLocalApi();
        if (!api) {
          return;
        }
        const clickedResult = await settlePromise(() =>
          api.contextMenu.show(
            project.memberProjects.map((member) => ({
              id: member.physicalProjectKey,
              label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
            })),
            {
              x: event.clientX,
              y: event.clientY,
            },
          ),
        );
        if (clickedResult._tag === "Failure") {
          const error = squashAtomCommandFailure(clickedResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not choose environment",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
        const clicked = clickedResult.value;
        if (!clicked) {
          return;
        }
        const targetMember = project.memberProjects.find(
          (member) => member.physicalProjectKey === clicked,
        );
        if (!targetMember) {
          return;
        }
        createThreadForProjectMember(targetMember);
      })();
    },
    [createThreadForProjectMember, project.groupedProjectCount, project.memberProjects],
  );

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      const result = await archiveThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [archiveThread],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
    renamingInputRef.current = null;
  }, []);

  const startThreadRename = useCallback((threadKey: string, title: string) => {
    setRenamingThreadKey(threadKey);
    setRenamingTitle(title);
    renamingCommittedRef.current = false;
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => {
          if (current !== threadKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          title: trimmed,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      finishRename();
    },
    [updateThreadMetadata],
  );

  const closeProjectRenameDialog = useCallback(() => {
    setProjectRenameTarget(null);
    setProjectRenameTitle("");
  }, []);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget) {
      return;
    }

    const trimmed = projectRenameTitle.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project title cannot be empty",
      });
      return;
    }

    if (trimmed === projectRenameTarget.title) {
      closeProjectRenameDialog();
      return;
    }

    const result = await updateProject({
      environmentId: projectRenameTarget.environmentId,
      input: {
        projectId: projectRenameTarget.id,
        title: trimmed,
      },
    });
    if (result._tag === "Success") {
      closeProjectRenameDialog();
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle, updateProject]);

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const threadProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const threadWorkspacePath =
        thread.worktreePath ?? threadProject?.workspaceRoot ?? project.workspaceRoot ?? null;
      const now = new Date();
      const clicked = await api.contextMenu.show(
        buildThreadContextMenuItems({
          branch: thread.branch,
          isRunning: thread.session?.status === "running" && thread.session.activeTurnId != null,
          snoozeState: resolveThreadSnoozeMenuState({
            thread,
            supportsSnooze:
              serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze ===
              true,
            now,
          }),
          now,
        }),
        position,
      );

      const snoozedUntil = snoozedUntilFromMenuAction(clicked);
      if (snoozedUntil !== null || clicked === "wake") {
        const result =
          snoozedUntil !== null
            ? await snoozeThread(threadRef, snoozedUntil)
            : await unsnoozeThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: snoozedUntil !== null ? "Failed to snooze thread" : "Failed to wake thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }

      if (clicked === "archive") {
        await attemptArchiveThread(threadRef);
        return;
      }

      if (clicked === "fork-thread") {
        const nextThreadId = newThreadId();
        const nextThreadRef = scopeThreadRef(thread.environmentId, nextThreadId);
        const result = await forkThreadContext({
          environmentId: thread.environmentId,
          input: {
            threadId: nextThreadId,
            projectId: thread.projectId,
            title: truncate(`Fork: ${thread.title}`),
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            sourceThreadId: thread.id,
          },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to fork thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
        const forkShellReady = await waitForServerThreadShell(nextThreadRef);
        if (!forkShellReady) {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "Fork created",
              description:
                "Its thread data has not reached this client yet. Open it from the sidebar after reconnecting.",
            }),
          );
          return;
        }
        navigateToThread(nextThreadRef);
        return;
      }

      if (clicked === "new-thread-on-branch") {
        // Explicit branch carry-over: reuse the thread's worktree when it
        // has one, otherwise its branch on the local checkout.
        const result = await settlePromise(() =>
          handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            envMode: thread.worktreePath ? "worktree" : "local",
            startFromOrigin: false,
          }),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }

      if (clicked === "rename") {
        startThreadRename(threadKey, thread.title);
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, resolveThreadCompletionTimestamp(thread));
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Path unavailable",
              description: "This thread does not have a workspace path to copy.",
            }),
          );
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      const result = await deleteThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [
      appSettingsConfirmThreadDelete,
      attemptArchiveThread,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      forkThreadContext,
      handleNewThread,
      markThreadUnread,
      memberProjectByScopedKey,
      navigateToThread,
      project.workspaceRoot,
      serverConfigs,
      snoozeThread,
      startThreadRename,
      unsnoozeThread,
    ],
  );

  return (
    <>
      {hideProjectHeader ? null : (
        <div className="group/project-header relative">
          <SidebarMenuButton
            ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
            size="sm"
            className={cn(
              "h-8 gap-2 px-2 pr-8 text-left hover:bg-sidebar-row-hover group-hover/project-header:bg-sidebar-row-hover group-hover/project-header:text-sidebar-foreground max-sm:pr-14 dark:hover:text-white/86 dark:group-hover/project-header:text-white/86",
              SIDEBAR_MUTED_TEXT_CLASS,
              isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
            )}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
            onPointerDownCapture={handleProjectButtonPointerDownCapture}
            onClick={handleProjectButtonClick}
            onKeyDown={handleProjectButtonKeyDown}
            onContextMenu={handleProjectButtonContextMenu}
          >
            {/* EXPERIMENT (upstream project status indicator, off by default).
                Leading status dot for a collapsed project, swapping to the
                chevron on hover, instead of our trailing chevron. Delete this
                branch and the `projectStatusIndicatorEnabled` flag once the
                comparison is settled. */}
            {projectStatusIndicatorEnabled ? (
              !projectExpanded && projectStatus ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        aria-label={projectStatus.label}
                        className={cn(
                          "-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center",
                          projectStatus.colorClass,
                        )}
                      />
                    }
                  >
                    <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                      <span
                        className={cn(
                          "size-[9px] rounded-full",
                          projectStatus.dotClass,
                          projectStatus.pulse && "animate-status-pulse",
                        )}
                      />
                    </span>
                    <ChevronRightIcon
                      className={cn(
                        "absolute inset-0 m-auto size-3.5 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100",
                        SIDEBAR_MUTED_TEXT_CLASS,
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{projectStatus.label}</TooltipPopup>
                </Tooltip>
              ) : (
                <ChevronRightIcon
                  className={cn(
                    "-ml-0.5 size-3.5 shrink-0 transition-transform duration-150",
                    SIDEBAR_MUTED_TEXT_CLASS,
                    projectExpanded && "rotate-90",
                  )}
                />
              )
            ) : null}
            <ProjectFavicon
              environmentId={project.environmentId}
              cwd={project.workspaceRoot}
              repositoryIdentity={project.repositoryIdentity}
              visualIdentityKey={project.visualIdentityKey}
              className="size-4 dark:text-white/[0.175]"
            />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className={cn("truncate", SIDEBAR_LABEL_COLOR_CLASS, SIDEBAR_LABEL_TEXT_CLASS)}>
                {project.displayName}
              </span>
              {projectStatusIndicatorEnabled ? null : (
                <ChevronRightIcon
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-150",
                    SIDEBAR_MUTED_TEXT_CLASS,
                    projectExpanded && "rotate-90",
                  )}
                />
              )}
            </span>
          </SidebarMenuButton>
          {/* Environment badge – visible by default, crossfades with the
            "new thread" button on hover using the same pointer-events +
            opacity pattern as the thread row archive/timestamp swap. */}
          {project.environmentPresence === "remote-only" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label={
                      project.allRemoteMembersAreDesktopLocal
                        ? "Local sandbox project"
                        : "Remote project"
                    }
                    className={cn(
                      "pointer-events-none absolute inset-y-0 right-2 my-auto flex size-5 items-center justify-center rounded-md transition-opacity duration-150 max-sm:right-8 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0 max-sm:group-hover/project-header:opacity-100 max-sm:group-focus-within/project-header:opacity-100",
                      SIDEBAR_MUTED_TEXT_CLASS,
                    )}
                  />
                }
              >
                {project.allRemoteMembersAreDesktopLocal ? (
                  <ContainerIcon className="size-3" />
                ) : (
                  <CloudIcon className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {project.allRemoteMembersAreDesktopLocal
                  ? `Local sandbox: ${project.remoteEnvironmentLabels.join(", ")}`
                  : `Remote environment: ${project.remoteEnvironmentLabels.join(", ")}`}
              </TooltipPopup>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="pointer-events-none absolute inset-y-0 right-2 my-auto flex size-5 items-center justify-center opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
                  <button
                    type="button"
                    aria-label={`Create new thread in ${project.displayName}`}
                    data-testid="new-thread-button"
                    className={cn(
                      "flex size-5 cursor-pointer items-center justify-center rounded-md hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:hover:text-white/86",
                      SIDEBAR_MUTED_TEXT_CLASS,
                    )}
                    onClick={handleCreateThreadClick}
                  >
                    <SquarePenIcon className="block size-4" />
                  </button>
                </div>
              }
            />
            <TooltipPopup side="top">
              {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
            </TooltipPopup>
          </Tooltip>
        </div>
      )}

      <SidebarProjectThreadList
        projectKey={project.projectKey}
        projectExpanded={projectExpanded}
        hasOverflowingThreads={hasOverflowingThreads}
        orderedProjectThreadKeys={orderedProjectThreadKeys}
        renderedThreads={renderedThreads}
        snoozedThreads={snoozedThreads}
        snoozedExpanded={snoozedExpanded}
        toggleSnoozedExpanded={toggleSnoozedExpanded}
        showEmptyThreadState={showEmptyThreadState}
        shouldShowThreadPanel={shouldShowThreadPanel}
        isThreadListExpanded={isThreadListExpanded}
        activeRouteThreadKey={activeRouteThreadKey}
        threadJumpLabelByKey={threadJumpLabelByKey}
        threadContentClassName={threadContentClassName}
        renamingThreadKey={renamingThreadKey}
        renamingTitle={renamingTitle}
        setRenamingTitle={setRenamingTitle}
        startThreadRename={startThreadRename}
        renamingInputRef={renamingInputRef}
        renamingCommittedRef={renamingCommittedRef}
        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
        handleThreadClick={handleThreadClick}
        navigateToThread={navigateToThread}
        handleMultiSelectContextMenu={handleMultiSelectContextMenu}
        handleThreadContextMenu={handleThreadContextMenu}
        clearSelection={clearSelection}
        commitRename={commitRename}
        cancelRename={cancelRename}
        expandThreadListForProject={expandThreadListForProject}
        collapseThreadListForProject={collapseThreadListForProject}
      />

      <Dialog
        open={projectRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRenameDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              {projectRenameTarget
                ? `Update the title for ${projectRenameTarget.workspaceRoot}.`
                : "Update the project title."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Project title</span>
              <Input
                aria-label="Project title"
                value={projectRenameTitle}
                onChange={(event) => setProjectRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitProjectRename();
                  }
                }}
              />
            </div>
            {projectRenameTarget?.environmentLabel ? (
              <p className="text-sm text-muted-foreground">
                Environment: {projectRenameTarget.environmentLabel}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRenameDialog}>
              Cancel
            </Button>
            <Button onClick={() => void submitProjectRename()}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={projectGroupingTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectGroupingDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Project grouping</DialogTitle>
            <DialogDescription>
              {projectGroupingTarget
                ? `Choose how ${projectGroupingTarget.workspaceRoot} should be grouped in the sidebar.`
                : "Choose how this project should be grouped in the sidebar."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Grouping rule</span>
              <Select
                value={projectGroupingSelection}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    setProjectGroupingSelection(value);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label="Project grouping rule">
                  <SelectValue>
                    {projectGroupingSelection === "inherit"
                      ? `Use global default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                      : PROJECT_GROUPING_MODE_LABELS[projectGroupingSelection]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="inherit">
                    Use global default
                  </SelectItem>
                  <SelectItem hideIndicator value="repository">
                    {PROJECT_GROUPING_MODE_LABELS.repository}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository_path">
                    {PROJECT_GROUPING_MODE_LABELS.repository_path}
                  </SelectItem>
                  <SelectItem hideIndicator value="separate">
                    {PROJECT_GROUPING_MODE_LABELS.separate}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              {projectGroupingSelection === "inherit"
                ? projectGroupingModeDescription(projectGroupingSettings.sidebarProjectGroupingMode)
                : projectGroupingModeDescription(projectGroupingSelection)}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectGroupingDialog}>
              Cancel
            </Button>
            <Button onClick={saveProjectGroupingPreference}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

const SidebarProjectListRow = memo(function SidebarProjectListRow(props: SidebarProjectItemProps) {
  return (
    <SidebarMenuItem className="rounded-md">
      <SidebarProjectItem {...props} />
    </SidebarMenuItem>
  );
});

function LocalSecondaryStatus() {
  const { environments } = useEnvironments();
  // The desktop reports which local secondary backends (e.g. the WSL backend)
  // exist; the hook polls because the bridge has no change event. A backend that
  // is still cold-booting has no httpBaseUrl yet and isn't in the catalog, so we
  // surface "Connecting" straight from the bootstrap list and clear it once the
  // matching environment reports a connected phase.
  const secondaries = useDesktopLocalBootstraps();

  // Connected desktop-local environments keyed by their backend URL so we can
  // match a bootstrap (which only knows the URL) to its connection phase.
  const localEnvByUrl = useMemo(() => {
    const map = new Map<string, { phase: string; error: string | null }>();
    for (const environment of environments) {
      if (
        isDesktopLocalConnectionTarget(environment.entry.target) &&
        environment.displayUrl !== null
      ) {
        map.set(environment.displayUrl, {
          phase: environment.connection.phase,
          error: environment.connection.error,
        });
      }
    }
    return map;
  }, [environments]);

  const connecting: string[] = [];
  const failed: Array<{ label: string; error: string | null }> = [];
  for (const bootstrap of secondaries) {
    const env =
      bootstrap.httpBaseUrl !== null ? localEnvByUrl.get(bootstrap.httpBaseUrl) : undefined;
    if (env?.phase === "connected") {
      continue;
    }
    if (env?.phase === "error") {
      failed.push({ label: bootstrap.label, error: env.error });
      continue;
    }
    connecting.push(bootstrap.label);
  }

  if (connecting.length === 0 && failed.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="px-2 pt-2 pb-0">
      {connecting.length > 0 ? (
        <Alert
          variant="default"
          className="rounded-2xl border-border/40 bg-accent/40 text-muted-foreground"
        >
          <LoaderIcon className="animate-spin" />
          <AlertTitle className="text-sm font-medium text-foreground">
            Connecting {connecting.join(", ")}
          </AlertTitle>
        </Alert>
      ) : null}
      {failed.length > 0 ? (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
          <TriangleAlertIcon />
          <AlertTitle>Couldn't connect {failed.map((entry) => entry.label).join(", ")}</AlertTitle>
          <AlertDescription>
            {failed
              .map((entry) => entry.error)
              .filter(Boolean)
              .join("; ") || "The backend didn't respond."}
          </AlertDescription>
        </Alert>
      ) : null}
    </SidebarGroup>
  );
}

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

const FOCUSED_PROJECT_PREVIEW_COUNT = 3;
const FOCUSED_THREAD_PREVIEW_COUNT = 30;

function SidebarViewModeButton({
  viewMode,
  onViewModeChange,
}: {
  viewMode: SidebarViewMode;
  onViewModeChange: (viewMode: SidebarViewMode) => void;
}) {
  // Back to a one-click toggle between the two shipping modes. A stored "v2"
  // lands here too: it reads as "Classic view" and one click writes "nested",
  // so anyone who selected the parked Flat view gets out on the first press.
  const nextViewMode = viewMode === "nested" ? "focused" : "nested";

  return (
    <SidebarMenuButton
      size="sm"
      className={cn(
        "h-8 w-full justify-start gap-2 px-2 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset dark:hover:text-white/86",
        SIDEBAR_MUTED_TEXT_CLASS,
      )}
      onClick={() => onViewModeChange(nextViewMode)}
    >
      <ArrowRightIcon className="size-4" />
      <span
        className={cn(
          "flex-1 truncate text-left",
          SIDEBAR_LABEL_COLOR_CLASS,
          SIDEBAR_LABEL_TEXT_CLASS,
        )}
      >
        {viewMode === "nested" ? "Focus view" : "Classic view"}
      </span>
    </SidebarMenuButton>
  );
}

function SidebarSectionHeader({
  title,
  open,
  action,
}: {
  title: string;
  open: boolean;
  action?: React.ReactNode;
}) {
  return (
    <CollapsibleTrigger
      nativeButton={false}
      render={
        <SidebarGroupLabel
          className={cn(
            "group/sidebar-section-header h-8 cursor-pointer justify-start gap-2 px-2",
            SIDEBAR_MUTED_TEXT_CLASS,
            SIDEBAR_LABEL_TEXT_CLASS,
          )}
        />
      }
    >
      <span className="min-w-0 truncate">{title}</span>
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0 transition-transform duration-150",
          SIDEBAR_MUTED_TEXT_CLASS,
          open && "rotate-90",
        )}
      />
      <span className="min-w-0 flex-1" />
      {action}
    </CollapsibleTrigger>
  );
}

function FocusedProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: SidebarProjectSnapshot;
  selected: boolean;
  onSelect: (projectKey: string) => void;
}) {
  return (
    <SidebarMenuItem className="rounded-md">
      <SidebarMenuButton
        size="sm"
        isActive={selected}
        className="h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86 dark:data-[active=true]:text-white/82"
        onClick={() => onSelect(project.projectKey)}
      >
        <ProjectFavicon
          environmentId={project.environmentId}
          cwd={project.workspaceRoot}
          repositoryIdentity={project.repositoryIdentity}
          visualIdentityKey={project.visualIdentityKey}
          className="size-4 dark:text-white/[0.175]"
        />
        <span className={cn("min-w-0 flex-1 truncate", SIDEBAR_LABEL_TEXT_CLASS)}>
          {project.displayName}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface FocusedSidebarProjectViewProps {
  projects: readonly SidebarProjectSnapshot[];
  selectedProject: SidebarProjectSnapshot | null;
  selectedProjectKey: string | null;
  expandedThreadListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  routeThreadKey: string | null;
  newThreadShortcutLabel: string | null;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  snoozeThread: ReturnType<typeof useThreadActions>["snoozeThread"];
  unsnoozeThread: ReturnType<typeof useThreadActions>["unsnoozeThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  onProjectSelect: (projectKey: string) => void;
}

const FocusedSidebarProjectView = memo(function FocusedSidebarProjectView(
  props: FocusedSidebarProjectViewProps,
) {
  const {
    projects,
    selectedProject,
    selectedProjectKey,
    expandedThreadListsByProject,
    activeRouteProjectKey,
    routeThreadKey,
    newThreadShortcutLabel,
    handleNewThread,
    archiveThread,
    deleteThread,
    snoozeThread,
    unsnoozeThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    onProjectSelect,
  } = props;
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [threadsOpen, setThreadsOpen] = useState(true);
  const { isMobile, setOpenMobile } = useSidebar();
  const visibleProjects = projects.slice(0, FOCUSED_PROJECT_PREVIEW_COUNT);
  const hasMoreProjects = projects.length > FOCUSED_PROJECT_PREVIEW_COUNT;
  const handleFocusedNewThreadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const targetMember = selectedProject?.memberProjects[0];
      if (!targetMember) return;
      if (isMobile) setOpenMobile(false);
      void handleNewThread(scopeProjectRef(targetMember.environmentId, targetMember.id));
    },
    [handleNewThread, isMobile, selectedProject?.memberProjects, setOpenMobile],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
        <SidebarSectionHeader title="Projects" open={projectsOpen} />
        <CollapsiblePanel className="data-open:overflow-visible">
          <SidebarMenu className="gap-0.5 pt-1">
            {visibleProjects.map((project) => (
              <FocusedProjectCard
                key={project.projectKey}
                project={project}
                selected={project.projectKey === selectedProjectKey}
                onSelect={onProjectSelect}
              />
            ))}
          </SidebarMenu>
          {hasMoreProjects ? (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-foreground/72 transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-white/82 dark:hover:text-white/86",
                      SIDEBAR_LABEL_TEXT_CLASS,
                    )}
                  />
                }
              >
                <MoreHorizontalIcon className={cn("size-4 shrink-0", SIDEBAR_MUTED_TEXT_CLASS)} />
                <span className="truncate">More</span>
              </MenuTrigger>
              <MenuPopup align="start" side="bottom" className="min-w-56">
                <MenuGroup>
                  <MenuGroupLabel>Projects</MenuGroupLabel>
                  {projects.map((project) => (
                    <MenuItem
                      key={project.projectKey}
                      onClick={() => onProjectSelect(project.projectKey)}
                    >
                      <ProjectFavicon
                        environmentId={project.environmentId}
                        cwd={project.workspaceRoot}
                        repositoryIdentity={project.repositoryIdentity}
                        visualIdentityKey={project.visualIdentityKey}
                        className="size-4"
                      />
                      <span className="truncate">{project.displayName}</span>
                    </MenuItem>
                  ))}
                </MenuGroup>
              </MenuPopup>
            </Menu>
          ) : null}
        </CollapsiblePanel>
      </Collapsible>

      <Collapsible open={threadsOpen} onOpenChange={setThreadsOpen}>
        <SidebarSectionHeader
          title={selectedProject ? `${selectedProject.displayName}'s threads` : "Threads"}
          open={threadsOpen}
          action={
            selectedProject ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Create new thread in ${selectedProject.displayName}`}
                      className={cn(
                        "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover/sidebar-section-header:opacity-100 group-focus-within/sidebar-section-header:opacity-100 dark:hover:text-white/86",
                        SIDEBAR_MUTED_TEXT_CLASS,
                      )}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={handleFocusedNewThreadClick}
                    >
                      <SquarePenIcon className="size-4" />
                    </button>
                  }
                />
                <TooltipPopup side="top">
                  {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
                </TooltipPopup>
              </Tooltip>
            ) : null
          }
        />
        <CollapsiblePanel>
          {selectedProject ? (
            <SidebarMenu className="gap-0.5 pt-1">
              <SidebarProjectListRow
                project={selectedProject}
                isThreadListExpanded={expandedThreadListsByProject.has(selectedProject.projectKey)}
                activeRouteThreadKey={
                  activeRouteProjectKey === selectedProject.projectKey ? routeThreadKey : null
                }
                projectExpandedOverride={threadsOpen}
                hideProjectHeader
                threadContentClassName="ml-0"
                threadPreviewLimit={FOCUSED_THREAD_PREVIEW_COUNT}
                newThreadShortcutLabel={newThreadShortcutLabel}
                handleNewThread={handleNewThread}
                archiveThread={archiveThread}
                deleteThread={deleteThread}
                snoozeThread={snoozeThread}
                unsnoozeThread={unsnoozeThread}
                threadJumpLabelByKey={threadJumpLabelByKey}
                attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                expandThreadListForProject={expandThreadListForProject}
                collapseThreadListForProject={collapseThreadListForProject}
                dragInProgressRef={dragInProgressRef}
                suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
                isManualProjectSorting={false}
                dragHandleProps={null}
              />
            </SidebarMenu>
          ) : (
            <div
              className={cn(
                "px-2 pt-4 text-center",
                SIDEBAR_MUTED_TEXT_CLASS,
                SIDEBAR_LABEL_TEXT_CLASS,
              )}
            >
              No projects yet
            </div>
          )}
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
});

function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

interface SidebarProjectsContentProps {
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateButtonAction: "download" | "install" | "none";
  desktopUpdateButtonDisabled: boolean;
  handleDesktopUpdateButtonClick: () => void;
  sidebarViewMode: SidebarViewMode;
  focusedProjectKey: string | null;
  onSidebarViewModeChange: (viewMode: SidebarViewMode) => void;
  onFocusedProjectChange: (projectKey: string) => void;
  openAddProject: () => void;
  isManualProjectSorting: boolean;
  projectDnDSensors: ReturnType<typeof useSensors>;
  projectCollisionDetection: CollisionDetection;
  handleProjectDragStart: (event: DragStartEvent) => void;
  handleProjectDragEnd: (event: DragEndEvent) => void;
  handleProjectDragCancel: (event: DragCancelEvent) => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  snoozeThread: ReturnType<typeof useThreadActions>["snoozeThread"];
  unsnoozeThread: ReturnType<typeof useThreadActions>["unsnoozeThread"];
  sortedProjects: readonly SidebarProjectSnapshot[];
  focusedProjects: readonly SidebarProjectSnapshot[];
  expandedThreadListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  routeThreadKey: string | null;
  newThreadShortcutLabel: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void;
  projectsLength: number;
}

const SidebarProjectsContent = memo(function SidebarProjectsContent(
  props: SidebarProjectsContentProps,
) {
  const {
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    handleDesktopUpdateButtonClick,
    sidebarViewMode,
    focusedProjectKey,
    onSidebarViewModeChange,
    onFocusedProjectChange,
    openAddProject,
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewThread,
    archiveThread,
    deleteThread,
    snoozeThread,
    unsnoozeThread,
    sortedProjects,
    focusedProjects,
    expandedThreadListsByProject,
    activeRouteProjectKey,
    routeThreadKey,
    newThreadShortcutLabel,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
    projectsLength,
  } = props;

  const selectedFocusedProject =
    sidebarViewMode === "focused"
      ? (focusedProjects.find((project) => project.projectKey === focusedProjectKey) ??
        focusedProjects[0] ??
        null)
      : null;

  return (
    <SidebarContent className="gap-0">
      <SidebarGroup className="px-2 pt-2 pb-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <CommandDialogTrigger
              render={
                <SidebarMenuButton
                  size="sm"
                  className={cn(
                    "h-8 w-full justify-start gap-2 px-2 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset dark:hover:text-white/86",
                    SIDEBAR_MUTED_TEXT_CLASS,
                  )}
                  data-testid="command-palette-trigger"
                />
              }
            >
              <SearchIcon className="size-4" />
              <span
                className={cn(
                  "flex-1 truncate text-left",
                  SIDEBAR_LABEL_COLOR_CLASS,
                  SIDEBAR_LABEL_TEXT_CLASS,
                )}
              >
                Search
              </span>
            </CommandDialogTrigger>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className={cn(
                "h-8 w-full justify-start gap-2 px-2 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset dark:hover:text-white/86",
                SIDEBAR_MUTED_TEXT_CLASS,
              )}
              data-testid="sidebar-add-project-trigger"
              onClick={openAddProject}
            >
              <PlusIcon className="size-4" />
              <span
                className={cn(
                  "flex-1 truncate text-left",
                  SIDEBAR_LABEL_COLOR_CLASS,
                  SIDEBAR_LABEL_TEXT_CLASS,
                )}
              >
                Project
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <WebFeatureNavigationItems slot="primary-after-project" />
          <SidebarMenuItem>
            <SidebarViewModeButton
              viewMode={sidebarViewMode}
              onViewModeChange={onSidebarViewModeChange}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
        <SidebarGroup className="px-2 pt-2 pb-0">
          <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
            <TriangleAlertIcon />
            <AlertTitle>Intel build on Apple Silicon</AlertTitle>
            <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
            {desktopUpdateButtonAction !== "none" ? (
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={desktopUpdateButtonDisabled}
                  onClick={handleDesktopUpdateButtonClick}
                >
                  {desktopUpdateButtonAction === "download"
                    ? "Download ARM build"
                    : "Install ARM build"}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        </SidebarGroup>
      ) : null}
      <LocalSecondaryStatus />
      <SidebarGroup className="px-2 py-2">
        {sidebarViewMode === "focused" ? (
          <FocusedSidebarProjectView
            projects={focusedProjects}
            selectedProject={selectedFocusedProject}
            selectedProjectKey={selectedFocusedProject?.projectKey ?? null}
            expandedThreadListsByProject={expandedThreadListsByProject}
            activeRouteProjectKey={activeRouteProjectKey}
            routeThreadKey={routeThreadKey}
            newThreadShortcutLabel={newThreadShortcutLabel}
            handleNewThread={handleNewThread}
            archiveThread={archiveThread}
            deleteThread={deleteThread}
            snoozeThread={snoozeThread}
            unsnoozeThread={unsnoozeThread}
            threadJumpLabelByKey={threadJumpLabelByKey}
            attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
            expandThreadListForProject={expandThreadListForProject}
            collapseThreadListForProject={collapseThreadListForProject}
            dragInProgressRef={dragInProgressRef}
            suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
            suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
            onProjectSelect={onFocusedProjectChange}
          />
        ) : isManualProjectSorting ? (
          <DndContext
            sensors={projectDnDSensors}
            collisionDetection={projectCollisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
            onDragStart={handleProjectDragStart}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={handleProjectDragCancel}
          >
            <SidebarMenu className="gap-0.5">
              <SortableContext
                items={sortedProjects.map((project) => project.projectKey)}
                strategy={verticalListSortingStrategy}
              >
                {sortedProjects.map((project) => (
                  <SortableProjectItem key={project.projectKey} projectId={project.projectKey}>
                    {(dragHandleProps) => (
                      <SidebarProjectItem
                        project={project}
                        isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                        activeRouteThreadKey={
                          activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                        }
                        newThreadShortcutLabel={newThreadShortcutLabel}
                        handleNewThread={handleNewThread}
                        archiveThread={archiveThread}
                        deleteThread={deleteThread}
                        snoozeThread={snoozeThread}
                        unsnoozeThread={unsnoozeThread}
                        threadJumpLabelByKey={threadJumpLabelByKey}
                        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                        expandThreadListForProject={expandThreadListForProject}
                        collapseThreadListForProject={collapseThreadListForProject}
                        dragInProgressRef={dragInProgressRef}
                        suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                        suppressProjectClickForContextMenuRef={
                          suppressProjectClickForContextMenuRef
                        }
                        isManualProjectSorting={isManualProjectSorting}
                        dragHandleProps={dragHandleProps}
                      />
                    )}
                  </SortableProjectItem>
                ))}
              </SortableContext>
            </SidebarMenu>
          </DndContext>
        ) : (
          <SidebarMenu ref={attachProjectListAutoAnimateRef} className="gap-0.5">
            {sortedProjects.map((project) => (
              <SidebarProjectListRow
                key={project.projectKey}
                project={project}
                isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                activeRouteThreadKey={
                  activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                }
                newThreadShortcutLabel={newThreadShortcutLabel}
                handleNewThread={handleNewThread}
                archiveThread={archiveThread}
                deleteThread={deleteThread}
                snoozeThread={snoozeThread}
                unsnoozeThread={unsnoozeThread}
                threadJumpLabelByKey={threadJumpLabelByKey}
                attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                expandThreadListForProject={expandThreadListForProject}
                collapseThreadListForProject={collapseThreadListForProject}
                dragInProgressRef={dragInProgressRef}
                suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
                isManualProjectSorting={isManualProjectSorting}
                dragHandleProps={null}
              />
            ))}
          </SidebarMenu>
        )}

        {sidebarViewMode !== "focused" && projectsLength === 0 && (
          <div
            className={cn(
              "px-2 pt-4 text-center",
              SIDEBAR_MUTED_TEXT_CLASS,
              SIDEBAR_LABEL_TEXT_CLASS,
            )}
          >
            No projects yet
          </div>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
});

export default function Sidebar() {
  const projects = useProjects();
  const sidebarThreads = useThreadShells();
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const sidebarThreadSortOrder = useClientSettings((s) => s.sidebarThreadSortOrder);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const storedSidebarViewMode = useClientSettings((s) => s.sidebarViewMode);
  const sidebarViewMode = resolveAvailableSidebarViewMode(storedSidebarViewMode);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const sidebarThreadPreviewCount = useClientSettings((s) => s.sidebarThreadPreviewCount);
  const updateSettings = useUpdateClientSettings();
  const handleNewThread = useNewThreadHandler();
  const { archiveThread, deleteThread, snoozeThread, unsnoozeThread } = useThreadActions();
  const { isMobile, setOpenMobile } = useSidebar();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [focusedProjectKey, setFocusedProjectKey] = useState<string | null>(null);
  const lastFocusedRouteProjectKeyRef = useRef<string | null>(null);
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const desktopUpdateState = useDesktopUpdateState();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const desktopLocalEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter((environment) => isDesktopLocalConnectionTarget(environment.entry.target))
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
  }, [projectOrder, projects]);

  // Build a mapping from physical project key → logical project key for
  // cross-environment grouping.  Projects that share a repositoryIdentity
  // canonicalKey are treated as one logical project in the sidebar.
  const physicalToLogicalKey = useMemo(() => {
    return buildPhysicalToLogicalProjectKeyMap({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
    });
  }, [orderedProjects, projectGroupingSettings, primaryEnvironmentId]);
  const projectPhysicalKeyByScopedRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );

  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(() => {
    return buildSidebarProjectSnapshots({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      isDesktopLocalEnvironment: (environmentId) => desktopLocalEnvironmentIds.has(environmentId),
    });
  }, [
    environmentLabelById,
    desktopLocalEnvironmentIds,
    orderedProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
  ]);

  const sidebarProjectByKey = useMemo(
    () => new Map(sidebarProjects.map((project) => [project.projectKey, project] as const)),
    [sidebarProjects],
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Resolve the active route's project key to a logical key so it matches the
  // sidebar's grouped project entries.
  const activeRouteProjectKey = useMemo(() => {
    if (!routeThreadKey) {
      return null;
    }
    const activeThread = sidebarThreadByKey.get(routeThreadKey);
    if (!activeThread) return null;
    const physicalKey =
      projectPhysicalKeyByScopedRef.get(
        scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId)),
      ) ?? scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId));
    return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
  }, [routeThreadKey, sidebarThreadByKey, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);

  // Group threads by logical project key so all threads from grouped projects
  // are displayed together.
  const threadsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarThreadSummary[]>();
    for (const thread of sidebarThreads) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(thread);
      } else {
        next.set(logicalKey, [thread]);
      }
    }
    return next;
  }, [sidebarThreads, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      modelPickerOpen: isModelPickerOpen(),
    }),
    [],
  );
  const newThreadShortcutLabelOptions = useMemo(() => ({ platform }), [platform]);
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", newThreadShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", newThreadShortcutLabelOptions);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, navigate, setOpenMobile, setSelectionAnchor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.projectKey === active.id);
      const overProject = sidebarProjects.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      const activeMemberKeys = activeProject.memberProjects.map(
        (member) => member.physicalProjectKey,
      );
      const overMemberKeys = overProject.memberProjects.map((member) => member.physicalProjectKey);
      reorderProjects(orderedProjects.map(getProjectOrderKey), activeMemberKeys, overMemberKeys);
    },
    [orderedProjects, sidebarProjectSortOrder, reorderProjects, sidebarProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  const isThreadSnoozed = useIsThreadSnoozed(sidebarThreads);
  const visibleThreads = useMemo(
    () => sidebarThreads.filter((thread) => thread.archivedAt === null),
    [sidebarThreads],
  );
  const sortedProjects = useMemo(() => {
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads.map((thread) => {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      return {
        ...thread,
        projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      };
    });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjectByKey,
    sidebarProjects,
    visibleThreads,
  ]);
  const selectedFocusedProject = useMemo(
    () =>
      sortedProjects.find((project) => project.projectKey === focusedProjectKey) ??
      sortedProjects.find((project) => project.projectKey === activeRouteProjectKey) ??
      sortedProjects[0] ??
      null,
    [activeRouteProjectKey, focusedProjectKey, sortedProjects],
  );
  const focusedProjects = useMemo(
    () =>
      selectedFocusedProject
        ? [
            selectedFocusedProject,
            ...sortedProjects.filter(
              (project) => project.projectKey !== selectedFocusedProject.projectKey,
            ),
          ]
        : sortedProjects,
    [selectedFocusedProject, sortedProjects],
  );

  useEffect(() => {
    if (sidebarViewMode !== "focused") return;

    const routeProjectChanged = activeRouteProjectKey !== lastFocusedRouteProjectKeyRef.current;
    lastFocusedRouteProjectKeyRef.current = activeRouteProjectKey;
    const focusedProjectExists = sortedProjects.some(
      (project) => project.projectKey === focusedProjectKey,
    );
    const nextProjectKey = routeProjectChanged
      ? (activeRouteProjectKey ?? selectedFocusedProject?.projectKey ?? null)
      : focusedProjectExists
        ? focusedProjectKey
        : (selectedFocusedProject?.projectKey ?? null);

    if (nextProjectKey !== focusedProjectKey) {
      setFocusedProjectKey(nextProjectKey);
    }
  }, [
    activeRouteProjectKey,
    focusedProjectKey,
    selectedFocusedProject?.projectKey,
    sidebarViewMode,
    sortedProjects,
  ]);

  const handleFocusedProjectChange = useCallback(
    (projectKey: string) => {
      setFocusedProjectKey(projectKey);
      const projectThreads = sortThreads(
        (threadsByProjectKey.get(projectKey) ?? []).filter((thread) => thread.archivedAt === null),
        sidebarThreadSortOrder,
      );
      const targetThread = projectThreads[0];
      if (targetThread) {
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
      }
    },
    [navigateToThread, sidebarThreadSortOrder, threadsByProjectKey],
  );

  const handleSidebarViewModeChange = useCallback(
    (viewMode: SidebarViewMode) => {
      if (viewMode === "focused") {
        setFocusedProjectKey(activeRouteProjectKey ?? sortedProjects[0]?.projectKey ?? null);
      }
      updateSettings({ sidebarViewMode: viewMode });
    },
    [activeRouteProjectKey, sortedProjects, updateSettings],
  );
  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const visibleSidebarThreadKeys = useMemo(() => {
    const focusedProject =
      sidebarViewMode === "focused" && selectedFocusedProject ? [selectedFocusedProject] : null;
    const visibleProjects = focusedProject ?? sortedProjects;
    const previewLimit = focusedProject ? FOCUSED_THREAD_PREVIEW_COUNT : sidebarThreadPreviewCount;

    return visibleProjects.flatMap((project) => {
      const projectThreads = sortThreads(
        (threadsByProjectKey.get(project.projectKey) ?? []).filter(
          (thread) => thread.archivedAt === null && !isThreadSnoozed(thread),
        ),
        sidebarThreadSortOrder,
      );
      const projectExpanded =
        focusedProject !== null ||
        resolveProjectExpanded(projectExpandedById, projectExpansionPreferenceKeys(project));
      const activeThreadKey = routeThreadKey ?? undefined;
      const pinnedCollapsedThread =
        !projectExpanded && activeThreadKey
          ? (projectThreads.find(
              (thread) =>
                scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                activeThreadKey,
            ) ?? null)
          : null;
      const shouldShowThreadPanel = projectExpanded || pinnedCollapsedThread !== null;
      if (!shouldShowThreadPanel) {
        return [];
      }
      const isThreadListExpanded = expandedThreadListsByProject.has(project.projectKey);
      const hasOverflowingThreads = projectThreads.length > previewLimit;
      const previewThreads =
        isThreadListExpanded || !hasOverflowingThreads
          ? projectThreads
          : projectThreads.slice(0, previewLimit);
      const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : previewThreads;
      return renderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
    });
  }, [
    sidebarThreadSortOrder,
    sidebarThreadPreviewCount,
    sidebarViewMode,
    selectedFocusedProject,
    expandedThreadListsByProject,
    isThreadSnoozed,
    projectExpandedById,
    routeThreadKey,
    sortedProjects,
    threadsByProjectKey,
  ]);
  const threadJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadKey] of visibleSidebarThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadKey, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadKeys]);
  const threadJumpThreadKeys = useMemo(
    () => [...threadJumpCommandByKey.keys()],
    [threadJumpCommandByKey],
  );
  const sidebarShortcutContext = {
    modelPickerOpen: isModelPickerOpen(),
  };
  const threadJumpLabelByKey = useMemo(
    () =>
      buildThreadJumpLabelMap({
        keybindings,
        platform,
        threadJumpCommandByKey,
      }),
    [keybindings, platform, threadJumpCommandByKey],
  );
  const shouldShowThreadJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform,
      context: sidebarShortcutContext,
    },
  );
  const visibleThreadJumpLabelByKey = showThreadJumpHints
    ? threadJumpLabelByKey
    : EMPTY_THREAD_JUMP_LABELS;
  const orderedSidebarThreadKeys = visibleSidebarThreadKeys;
  const prewarmedSidebarThreadKeys = useMemo(
    () => getSidebarThreadIdsToPrewarm(visibleSidebarThreadKeys),
    [visibleSidebarThreadKeys],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () =>
      prewarmedSidebarThreadKeys.flatMap((threadKey) => {
        const ref = parseScopedThreadKey(threadKey);
        return ref ? [ref] : [];
      }),
    [prewarmedSidebarThreadKeys],
  );

  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowThreadJumpHintsNow);
  }, [shouldShowThreadJumpHintsNow, updateThreadJumpHintsVisibility]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcutContext = getCurrentSidebarShortcutContext();

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadKey = resolveAdjacentThreadId({
          threadIds: orderedSidebarThreadKeys,
          currentThreadId: routeThreadKey,
          direction: traversalDirection,
        });
        if (!targetThreadKey) {
          return;
        }
        const targetThread = sidebarThreadByKey.get(targetThreadKey);
        if (!targetThread) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadKey = threadJumpThreadKeys[jumpIndex];
      if (!targetThreadKey) {
        return;
      }
      const targetThread = sidebarThreadByKey.get(targetThreadKey);
      if (!targetThread) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
    };

    window.addEventListener("keydown", onWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    getCurrentSidebarShortcutContext,
    keybindings,
    navigateToThread,
    orderedSidebarThreadKeys,
    platform,
    routeThreadKey,
    sidebarThreadByKey,
    threadJumpThreadKeys,
  ]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!useThreadSelectionStore.getState().hasSelection()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection]);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState, navigator.platform),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  return (
    <>
      {prewarmedSidebarThreadRefs.map((threadRef) => (
        <SidebarThreadDetailPrewarmer key={scopedThreadKey(threadRef)} threadRef={threadRef} />
      ))}
      <SidebarChromeHeader isElectron={isElectron} />

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <SidebarProjectsContent
            showArm64IntelBuildWarning={showArm64IntelBuildWarning}
            arm64IntelBuildWarningDescription={arm64IntelBuildWarningDescription}
            desktopUpdateButtonAction={desktopUpdateButtonAction}
            desktopUpdateButtonDisabled={desktopUpdateButtonDisabled}
            handleDesktopUpdateButtonClick={handleDesktopUpdateButtonClick}
            sidebarViewMode={sidebarViewMode}
            focusedProjectKey={selectedFocusedProject?.projectKey ?? focusedProjectKey}
            onSidebarViewModeChange={handleSidebarViewModeChange}
            onFocusedProjectChange={handleFocusedProjectChange}
            openAddProject={openAddProjectCommandPalette}
            isManualProjectSorting={isManualProjectSorting}
            projectDnDSensors={projectDnDSensors}
            projectCollisionDetection={projectCollisionDetection}
            handleProjectDragStart={handleProjectDragStart}
            handleProjectDragEnd={handleProjectDragEnd}
            handleProjectDragCancel={handleProjectDragCancel}
            handleNewThread={handleNewThread}
            archiveThread={archiveThread}
            deleteThread={deleteThread}
            snoozeThread={snoozeThread}
            unsnoozeThread={unsnoozeThread}
            sortedProjects={sortedProjects}
            focusedProjects={focusedProjects}
            expandedThreadListsByProject={expandedThreadListsByProject}
            activeRouteProjectKey={activeRouteProjectKey}
            routeThreadKey={routeThreadKey}
            newThreadShortcutLabel={newThreadShortcutLabel}
            threadJumpLabelByKey={visibleThreadJumpLabelByKey}
            attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
            expandThreadListForProject={expandThreadListForProject}
            collapseThreadListForProject={collapseThreadListForProject}
            dragInProgressRef={dragInProgressRef}
            suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
            suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
            attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
            projectsLength={projects.length}
          />

          <SidebarChromeFooter />
        </>
      )}
    </>
  );
}
