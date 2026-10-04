import { ThreadAccessory } from "./ThreadAccessory";
import {
  ChevronRightIcon,
  CloudIcon,
  ContainerIcon,
  LayoutGridIcon,
  LoaderIcon,
  MessageSquareDashedIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ThreadStatusLabel } from "./ThreadStatusIndicators";

import { ProjectFavicon } from "./ProjectFavicon";
import { waitForServerThreadShell } from "./ChatView.logic";
import { useAtomValue } from "@effect/atom-react";
import { autoAnimate } from "@formkit/auto-animate";
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import {
  type ContextMenuItem,
  type ProjectId,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ResolvedKeybindingsConfig,
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
import type { SidebarThreadSortOrder } from "@upcomputer/contracts/settings";
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
import { useUiStateStore } from "../uiStateStore";
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
import { useIsScratchProject, useScratchProject } from "../hooks/useScratchProject";
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
  projectKeyFromOpenProjectMenuAction,
  resolveThreadSnoozeMenuState,
  snoozedUntilFromMenuAction,
  formatSidebarThreadTimestamp,
  resolveAdjacentThreadId,
  isTrailingDoubleClick,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
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
import { useClientSettings } from "~/hooks/useSettings";
import { primaryServerKeybindingsAtom } from "../state/server";
import type { Project, SidebarThreadSummary } from "../types";
import type { SidebarProjectGroupMember, SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { WebFeatureNavigationItems } from "./product/WebFeatureNavigation";
import {
  SIDEBAR_LABEL_COLOR_CLASS,
  SIDEBAR_LABEL_TEXT_CLASS,
  SIDEBAR_MUTED_TEXT_CLASS,
} from "./sidebar/sidebarTextStyles";
import {
  buildProjectIndex,
  filterThreadsByProjectRefs,
  findLogicalProjectKeyForRef,
  resolveSidebarProjectFilter,
  resolveThreadDisplayProjects,
  resolveThreadProjectIconStack,
  selectPreviewProjects,
  type SidebarProjectFilter,
} from "./sidebar/sidebarProjectFilter.logic";
import { useSidebarLogicalProjects } from "./sidebar/useSidebarProjects";
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();
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

type SidebarProjectIndex = ReadonlyMap<string, Project>;
type IsScratchProject = (project: Project) => boolean;

/**
 * Leading project marker for a chat row: a row of the
 * projects the thread shows under (own project unless it is the scratch
 * "No project", then linked ones), or a muted chat icon for an unlinked
 * scratch chat.
 */
const SidebarThreadProjectIcons = memo(function SidebarThreadProjectIcons(props: {
  thread: SidebarThreadSummary;
  projectByKey: SidebarProjectIndex;
  isScratchProject: IsScratchProject;
}) {
  const { thread, projectByKey, isScratchProject } = props;
  const stack = useMemo(
    () => resolveThreadProjectIconStack({ thread, projectByKey, isScratchProject }),
    [isScratchProject, projectByKey, thread],
  );
  if (stack.showScratchIcon) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label="No project"
              className="inline-flex size-4 shrink-0 items-center justify-center"
              data-testid={`thread-project-icons-${thread.id}`}
            />
          }
        >
          <MessageSquareDashedIcon className={cn("size-3.5", SIDEBAR_MUTED_TEXT_CLASS)} />
        </TooltipTrigger>
        <TooltipPopup side="top">No project</TooltipPopup>
      </Tooltip>
    );
  }
  if (stack.visibleProjects.length === 0) return null;
  const projectNames = stack.allProjects.map((project) => project.title).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={projectNames}
            className="flex shrink-0 items-center gap-0.5"
            data-testid={`thread-project-icons-${thread.id}`}
          />
        }
      >
        {stack.visibleProjects.map((project) => (
          <span
            key={scopedProjectKey(scopeProjectRef(project.environmentId, project.id))}
            className="inline-flex size-4 shrink-0 items-center justify-center"
          >
            <ProjectFavicon
              environmentId={project.environmentId}
              cwd={project.workspaceRoot}
              repositoryIdentity={project.repositoryIdentity}
              className="size-4"
            />
          </span>
        ))}
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
        {projectNames}
      </TooltipPopup>
    </Tooltip>
  );
});

/** Fades a thread row's trailing label while the row actions are shown. */
const THREAD_ROW_TRAILING_FADE_CLASS =
  "transition-opacity duration-150 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0";

interface SidebarThreadRowProps {
  thread: SidebarThreadSummary;
  projectByKey: SidebarProjectIndex;
  isScratchProject: IsScratchProject;
  /** Filtered to one project: every row would repeat its icon, so drop them. */
  hideProjectIcons: boolean;
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
    projectByKey,
    isScratchProject,
    hideProjectIcons,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const markedUnread = useUiStateStore((state) => state.threadMarkedUnreadById[threadKey] === true);
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
      markedUnread,
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
  const timeLabel = formatSidebarThreadTimestamp(
    thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
  );

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
        <div className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", contentClassName)}>
          {hideProjectIcons ? null : (
            <SidebarThreadProjectIcons
              thread={thread}
              projectByKey={projectByKey}
              isScratchProject={isScratchProject}
            />
          )}
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
            {/* Labels fade under the row actions. Accessory content stays visible,
                so the block shifts left to make room instead. */}
            <span className="pointer-events-none transition-[padding] duration-150 max-sm:pr-6 group-hover/menu-sub-item:not-has-[[data-sidebar-fading-label]]:pr-6 group-focus-within/menu-sub-item:not-has-[[data-sidebar-fading-label]]:pr-6 has-[[data-popup-open]]:pr-6">
              <span className="inline-flex items-center gap-1">
                {isRemoteThread && !isDesktopLocalThread && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={threadEnvironmentLabel ?? "Remote"}
                          className={cn(
                            "inline-flex items-center justify-center",
                            THREAD_ROW_TRAILING_FADE_CLASS,
                          )}
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
                          data-sidebar-fading-label
                          className={cn(
                            "inline-flex h-6 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-sm font-medium tracking-tight text-foreground shadow-sm",
                            THREAD_ROW_TRAILING_FADE_CLASS,
                          )}
                        />
                      }
                    >
                      {jumpLabel}
                    </TooltipTrigger>
                    <TooltipPopup side="top">{jumpLabel}</TooltipPopup>
                  </Tooltip>
                ) : wakeLabel !== undefined ? (
                  <span
                    data-sidebar-fading-label
                    className={cn(
                      SIDEBAR_MUTED_TEXT_CLASS,
                      SIDEBAR_LABEL_TEXT_CLASS,
                      THREAD_ROW_TRAILING_FADE_CLASS,
                    )}
                  >
                    {wakeLabel}
                  </span>
                ) : (
                  <span className={cn(SIDEBAR_MUTED_TEXT_CLASS, SIDEBAR_LABEL_TEXT_CLASS)}>
                    <ThreadAccessory
                      environmentId={thread.environmentId}
                      threadId={thread.id}
                      timeLabel={timeLabel}
                      fallback={
                        <span data-sidebar-fading-label className={THREAD_ROW_TRAILING_FADE_CLASS}>
                          {timeLabel}
                        </span>
                      }
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
  projectByKey: SidebarProjectIndex;
  isScratchProject: IsScratchProject;
  hideProjectIcons: boolean;
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
    projectByKey,
    isScratchProject,
    hideProjectIcons,
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
  const threadAuxiliaryContentClassName = threadContentClassName;
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
        projectByKey={projectByKey}
        isScratchProject={isScratchProject}
        hideProjectIcons={hideProjectIcons}
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
            <span className={threadAuxiliaryContentClassName}>No chats yet</span>
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

const CHAT_LIST_PREVIEW_COUNT = 20;
const PROJECT_PREVIEW_COUNT = 3;

function reportSidebarError(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

interface SidebarChatListProps {
  /** Key for the list's "Show more" state (one per project filter). */
  listKey: string;
  /** Non-archived chats that match the current project filter, across projects. */
  threads: readonly SidebarThreadSummary[];
  isThreadListExpanded: boolean;
  activeRouteThreadKey: string | null;
  projectByKey: SidebarProjectIndex;
  isScratchProject: IsScratchProject;
  hideProjectIcons: boolean;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  snoozeThread: ReturnType<typeof useThreadActions>["snoozeThread"];
  unsnoozeThread: ReturnType<typeof useThreadActions>["unsnoozeThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  onOpenProject: (projectRef: ScopedProjectRef) => void;
}

/**
 * The flat chat list. Rows can come from any project (including the hidden
 * scratch project), so every thread action resolves the thread's own project.
 */
const SidebarChatList = memo(function SidebarChatList(props: SidebarChatListProps) {
  const serverConfigs = useServerConfigs();
  const {
    listKey,
    threads,
    isThreadListExpanded,
    activeRouteThreadKey,
    projectByKey,
    isScratchProject,
    hideProjectIcons,
    handleNewThread,
    archiveThread,
    deleteThread,
    snoozeThread,
    unsnoozeThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    onOpenProject,
  } = props;
  const threadSortOrder = useClientSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const appSettingsConfirmThreadDelete = useClientSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const forkThreadContext = useAtomCommand(threadEnvironment.forkContext, {
    reportFailure: false,
  });
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
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
    onError: (error) => reportSidebarError("Failed to copy thread ID", error),
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
    onError: (error) => reportSidebarError("Failed to copy path", error),
  });
  const threadByKey = useMemo(
    () =>
      new Map(
        threads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [threads],
  );
  // Keep refs so callbacks can read the latest data without appearing in
  // dependency arrays (avoids invalidating every thread-row memo on each
  // thread-list change).
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;
  const projectByKeyRef = useRef(projectByKey);
  projectByKeyRef.current = projectByKey;
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [snoozedExpanded, setSnoozedExpanded] = useState(false);
  const toggleSnoozedExpanded = useCallback(() => setSnoozedExpanded((expanded) => !expanded), []);
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);

  const isThreadSnoozed = useIsThreadSnoozed(threads);
  const { visibleThreads, snoozedThreads, orderedThreadKeys } = useMemo(() => {
    const { active, snoozed } = partitionSnoozedThreads(
      threads.filter((thread) => thread.archivedAt === null),
      isThreadSnoozed,
    );
    const visibleThreads = sortThreads(active, threadSortOrder);
    return {
      snoozedThreads: snoozed,
      orderedThreadKeys: visibleThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
      visibleThreads,
    };
  }, [isThreadSnoozed, threads, threadSortOrder]);
  const hasOverflowingThreads = visibleThreads.length > CHAT_LIST_PREVIEW_COUNT;
  const renderedThreads = useMemo(
    () =>
      isThreadListExpanded || !hasOverflowingThreads
        ? visibleThreads
        : visibleThreads.slice(0, CHAT_LIST_PREVIEW_COUNT),
    [hasOverflowingThreads, isThreadListExpanded, visibleThreads],
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
        for (const { threadKey } of selectedThreadEntries) {
          markThreadUnread(threadKey);
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
              reportSidebarError("Failed to snooze threads", squashAtomCommandFailure(result));
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
          reportSidebarError(
            "Thread archived, but navigation failed",
            squashAtomCommandFailure(failure),
          );
        }
        if (archiveOutcome.mutationFailure) {
          removeFromSelection(archiveOutcome.archivedThreadKeys);
          if (!isAtomCommandInterrupted(archiveOutcome.mutationFailure)) {
            reportSidebarError(
              "Failed to archive threads",
              squashAtomCommandFailure(archiveOutcome.mutationFailure),
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
            reportSidebarError("Failed to delete threads", squashAtomCommandFailure(result));
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

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      const result = await archiveThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportSidebarError("Failed to archive thread", squashAtomCommandFailure(result));
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
        reportSidebarError("Failed to rename thread", squashAtomCommandFailure(result));
      }
      finishRename();
    },
    [updateThreadMetadata],
  );

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = threadByKeyRef.current.get(threadKey) ?? readThreadShell(threadRef);
      if (!thread) return;
      // The list mixes projects: resolve this thread's own project.
      const currentProjectByKey = projectByKeyRef.current;
      const threadProject = currentProjectByKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const threadWorkspacePath = thread.worktreePath ?? threadProject?.workspaceRoot ?? null;
      const openProjectRefByKey = new Map<string, ScopedProjectRef>();
      const openProjects = resolveThreadDisplayProjects(thread, currentProjectByKey)
        .filter((project) => !isScratchProject(project))
        .map((project) => {
          const projectRef = scopeProjectRef(project.environmentId, project.id);
          const key = scopedProjectKey(projectRef);
          openProjectRefByKey.set(key, projectRef);
          return { key, label: project.title };
        });
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
          openProjects,
        }),
        position,
      );

      const openProjectKey = projectKeyFromOpenProjectMenuAction(clicked);
      if (openProjectKey !== null) {
        const projectRef = openProjectRefByKey.get(openProjectKey);
        if (projectRef) onOpenProject(projectRef);
        return;
      }

      const snoozedUntil = snoozedUntilFromMenuAction(clicked);
      if (snoozedUntil !== null || clicked === "wake") {
        const result =
          snoozedUntil !== null
            ? await snoozeThread(threadRef, snoozedUntil)
            : await unsnoozeThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          reportSidebarError(
            snoozedUntil !== null ? "Failed to snooze thread" : "Failed to wake thread",
            squashAtomCommandFailure(result),
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
          reportSidebarError("Failed to fork thread", squashAtomCommandFailure(result));
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
          reportSidebarError("Could not create thread", squashAtomCommandFailure(result));
        }
        return;
      }

      if (clicked === "rename") {
        startThreadRename(threadKey, thread.title);
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey);
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
        reportSidebarError("Failed to delete thread", squashAtomCommandFailure(result));
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
      isScratchProject,
      markThreadUnread,
      navigateToThread,
      onOpenProject,
      serverConfigs,
      snoozeThread,
      startThreadRename,
      unsnoozeThread,
    ],
  );

  return (
    <SidebarProjectThreadList
      projectKey={listKey}
      projectExpanded
      projectByKey={projectByKey}
      isScratchProject={isScratchProject}
      hideProjectIcons={hideProjectIcons}
      hasOverflowingThreads={hasOverflowingThreads}
      orderedProjectThreadKeys={orderedThreadKeys}
      renderedThreads={renderedThreads}
      snoozedThreads={snoozedThreads}
      snoozedExpanded={snoozedExpanded}
      toggleSnoozedExpanded={toggleSnoozedExpanded}
      showEmptyThreadState={visibleThreads.length === 0 && snoozedThreads.length === 0}
      shouldShowThreadPanel
      isThreadListExpanded={isThreadListExpanded}
      activeRouteThreadKey={activeRouteThreadKey}
      threadJumpLabelByKey={threadJumpLabelByKey}
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
  );
});

interface SidebarProjectFilterRowProps {
  project: SidebarProjectSnapshot;
  selected: boolean;
  onSelect: (projectKey: string) => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
}

/**
 * A project in the Projects section. Clicking it filters the chat list; on
 * hover it offers the project menu (rename, copy path, delete) and a new chat
 * in the project. Grouped logical projects pick a member through submenus.
 */
const SidebarProjectFilterRow = memo(function SidebarProjectFilterRow(
  props: SidebarProjectFilterRowProps,
) {
  const { project, selected, onSelect, handleNewThread } = props;
  const deleteProject = useAtomCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const { isMobile, setOpenMobile } = useSidebar();
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
    onError: (error) => reportSidebarError("Failed to copy path", error),
  });
  const projectThreads = useThreadShellsForProjectRefs(project.memberProjectRefs);
  const projectThreadsRef = useRef(projectThreads);
  projectThreadsRef.current = projectThreads;
  const [projectRenameTarget, setProjectRenameTarget] = useState<SidebarProjectGroupMember | null>(
    null,
  );
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
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

  const openProjectRenameDialog = useCallback((member: SidebarProjectGroupMember) => {
    setProjectRenameTarget(member);
    setProjectRenameTitle(member.title);
  }, []);

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

                  const latestProjectThreads = projectThreadsRef.current.filter(
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

  const openProjectMenu = useCallback(
    (position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const actionHandlers = new Map<string, () => Promise<void> | void>();
        type ProjectMenuAction = "rename" | "copy-path" | "delete";
        const makeLeaf = (
          action: ProjectMenuAction,
          member: SidebarProjectGroupMember,
          options?: { destructive?: boolean },
        ): ContextMenuItem<string> => {
          const id = `${action}:${member.physicalProjectKey}`;
          actionHandlers.set(id, () => {
            switch (action) {
              case "rename":
                openProjectRenameDialog(member);
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
          };
        };

        const buildTargetedItem = (
          action: ProjectMenuAction,
          label: string,
          options?: { destructive?: boolean },
        ): ContextMenuItem<string> => {
          if (project.memberProjects.length === 1) {
            const singleMember = project.memberProjects[0]!;
            return {
              ...makeLeaf(action, singleMember, options),
              label,
              ...(action === "delete" ? { icon: "trash" } : {}),
            };
          }

          return {
            id: `${action}:submenu`,
            label,
            ...(action === "delete" ? { icon: "trash" } : {}),
            children: project.memberProjects.map((member) => makeLeaf(action, member, options)),
          };
        };

        const clickedResult = await settlePromise(() =>
          api.contextMenu.show(
            [
              buildTargetedItem("rename", "Rename"),
              buildTargetedItem("copy-path", "Copy Path"),
              buildTargetedItem("delete", "Delete", { destructive: true }),
            ],
            position,
          ),
        );
        if (clickedResult._tag === "Failure") {
          reportSidebarError("Project action failed", squashAtomCommandFailure(clickedResult));
          return;
        }
        const clicked = clickedResult.value;
        if (!clicked) {
          return;
        }

        await actionHandlers.get(clicked)?.();
      })();
    },
    [
      copyPathToClipboard,
      handleRemoveProject,
      openProjectRenameDialog,
      project.groupedProjectCount,
      project.memberProjects,
    ],
  );

  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      openProjectMenu({ x: event.clientX, y: event.clientY });
    },
    [openProjectMenu],
  );

  const handleMoreButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openProjectMenu({ x: rect.left, y: rect.bottom + 4 });
    },
    [openProjectMenu],
  );

  const handleNewThreadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const targetMember = project.memberProjects[0];
      if (!targetMember) return;
      if (isMobile) setOpenMobile(false);
      void (async () => {
        const result = await settlePromise(() =>
          handleNewThread(scopeProjectRef(targetMember.environmentId, targetMember.id)),
        );
        if (result._tag === "Failure") {
          reportSidebarError("Could not create thread", squashAtomCommandFailure(result));
        }
      })();
    },
    [handleNewThread, isMobile, project.memberProjects, setOpenMobile],
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
      reportSidebarError("Failed to rename project", squashAtomCommandFailure(result));
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle, updateProject]);

  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  return (
    <SidebarMenuItem className="group/project-row rounded-md">
      <SidebarMenuButton
        size="sm"
        isActive={selected}
        data-testid={`sidebar-project-row-${project.projectKey}`}
        className={cn(
          // Hover is keyed to the whole row, so it stays while the pointer is on the row actions.
          "h-8 gap-2 px-2 text-left group-hover/project-row:bg-sidebar-row-hover group-hover/project-row:text-sidebar-foreground group-hover/project-row:pr-14 group-focus-within/project-row:pr-14 data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground max-sm:pr-14 dark:group-hover/project-row:text-white/86 dark:data-[active=true]:text-white/82",
          SIDEBAR_LABEL_COLOR_CLASS,
        )}
        onClick={() => onSelect(project.projectKey)}
        onContextMenu={handleRowContextMenu}
      >
        <ProjectFavicon
          environmentId={project.environmentId}
          cwd={project.workspaceRoot}
          repositoryIdentity={project.repositoryIdentity}
          visualIdentityKey={project.visualIdentityKey}
          className="size-4"
        />
        <span className={cn("min-w-0 flex-1 truncate", SIDEBAR_LABEL_TEXT_CLASS)}>
          {project.displayName}
        </span>
      </SidebarMenuButton>
      {/* Environment badge crossfades with the hover actions. */}
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
                  "pointer-events-none absolute inset-y-0 right-2 my-auto flex size-5 items-center justify-center rounded-md transition-opacity duration-150 max-sm:hidden group-hover/project-row:opacity-0 group-focus-within/project-row:opacity-0",
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
      <div className="pointer-events-none absolute inset-y-0 right-1.5 my-auto flex h-5 items-center gap-1 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 group-focus-within/project-row:pointer-events-auto group-focus-within/project-row:opacity-100">
        <button
          type="button"
          data-testid={`sidebar-project-actions-${project.projectKey}`}
          aria-label={`Project actions for ${project.displayName}`}
          className={cn(
            "flex size-5 cursor-pointer items-center justify-center transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:hover:text-white/86",
            SIDEBAR_MUTED_TEXT_CLASS,
          )}
          onPointerDown={stopPropagationOnPointerDown}
          onClick={handleMoreButtonClick}
        >
          <MoreHorizontalIcon className="block size-4" />
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`New chat in ${project.displayName}`}
                data-testid="new-thread-button"
                className={cn(
                  "flex size-5 cursor-pointer items-center justify-center transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:hover:text-white/86",
                  SIDEBAR_MUTED_TEXT_CLASS,
                )}
                onPointerDown={stopPropagationOnPointerDown}
                onClick={handleNewThreadClick}
              />
            }
          >
            <SquarePenIcon className="block size-4" />
          </TooltipTrigger>
          <TooltipPopup side="top">New chat in {project.displayName}</TooltipPopup>
        </Tooltip>
      </div>

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

/** Hover-revealed icon button in a section header; never toggles the section. */
function SidebarSectionHeaderAction({
  label,
  tooltip,
  onClick,
  children,
  testId,
}: {
  label: string;
  tooltip: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-testid={testId}
            className={cn(
              "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover/sidebar-section-header:opacity-100 group-focus-within/sidebar-section-header:opacity-100 max-sm:opacity-100 dark:hover:text-white/86",
              SIDEBAR_MUTED_TEXT_CLASS,
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClick();
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

const PROJECT_ROW_BUTTON_CLASS_NAME =
  "h-8 gap-2 px-2 text-left hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground dark:hover:text-white/86 dark:data-[active=true]:text-white/82";

interface UnifiedSidebarViewProps {
  projects: readonly SidebarProjectSnapshot[];
  activeFilter: SidebarProjectFilter | null;
  onSelectFilter: (projectKey: string | null) => void;
  projectsOpen: boolean;
  onProjectsOpenChange: (open: boolean) => void;
  chatsOpen: boolean;
  onChatsOpenChange: (open: boolean) => void;
  openAddProject: () => void;
  newChatShortcutLabel: string | null;
  onNewChat: () => void;
  chatListKey: string;
  chatThreads: readonly SidebarThreadSummary[];
  isChatListExpanded: boolean;
  routeThreadKey: string | null;
  projectByKey: SidebarProjectIndex;
  isScratchProject: IsScratchProject;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  snoozeThread: ReturnType<typeof useThreadActions>["snoozeThread"];
  unsnoozeThread: ReturnType<typeof useThreadActions>["unsnoozeThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  onOpenProject: (projectRef: ScopedProjectRef) => void;
}

/**
 * The single sidebar view: a Projects section that filters, and one flat
 * Chats list across every project (including chats without a project).
 */
const UnifiedSidebarView = memo(function UnifiedSidebarView(props: UnifiedSidebarViewProps) {
  const {
    projects,
    activeFilter,
    onSelectFilter,
    projectsOpen,
    onProjectsOpenChange,
    chatsOpen,
    onChatsOpenChange,
    openAddProject,
    newChatShortcutLabel,
    onNewChat,
    chatListKey,
    chatThreads,
    isChatListExpanded,
    routeThreadKey,
    projectByKey,
    isScratchProject,
    handleNewThread,
    archiveThread,
    deleteThread,
    snoozeThread,
    unsnoozeThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    onOpenProject,
  } = props;
  const selectedProjectKey = activeFilter?.key ?? null;
  const previewProjects = useMemo(
    () => selectPreviewProjects(projects, selectedProjectKey, PROJECT_PREVIEW_COUNT),
    [projects, selectedProjectKey],
  );
  const hasMoreProjects = projects.length > PROJECT_PREVIEW_COUNT;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Collapsible open={projectsOpen} onOpenChange={onProjectsOpenChange}>
        <SidebarSectionHeader
          title="Projects"
          open={projectsOpen}
          action={
            <SidebarSectionHeaderAction
              label="Add project"
              tooltip="Add project"
              testId="sidebar-add-project-trigger"
              onClick={openAddProject}
            >
              <PlusIcon className="size-4" />
            </SidebarSectionHeaderAction>
          }
        />
        <CollapsiblePanel className="data-open:overflow-visible">
          <SidebarMenu className="gap-0.5 pt-1">
            <SidebarMenuItem className="rounded-md">
              <SidebarMenuButton
                size="sm"
                isActive={activeFilter === null}
                data-testid="sidebar-project-row-all"
                className={cn(PROJECT_ROW_BUTTON_CLASS_NAME, SIDEBAR_LABEL_COLOR_CLASS)}
                onClick={() => onSelectFilter(null)}
              >
                <LayoutGridIcon className={cn("size-4", SIDEBAR_MUTED_TEXT_CLASS)} />
                <span className={cn("min-w-0 flex-1 truncate", SIDEBAR_LABEL_TEXT_CLASS)}>
                  All projects
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {previewProjects.map((project) => (
              <SidebarProjectFilterRow
                key={project.projectKey}
                project={project}
                selected={project.projectKey === selectedProjectKey}
                onSelect={onSelectFilter}
                handleNewThread={handleNewThread}
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
                      "mt-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2 text-foreground/72 transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-white/82 dark:hover:text-white/86",
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
                      onClick={() => onSelectFilter(project.projectKey)}
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

      <Collapsible open={chatsOpen} onOpenChange={onChatsOpenChange}>
        <SidebarSectionHeader
          title="Chats"
          open={chatsOpen}
          action={
            <SidebarSectionHeaderAction
              label="New chat"
              tooltip={newChatShortcutLabel ? `New chat (${newChatShortcutLabel})` : "New chat"}
              testId="sidebar-new-chat-button"
              onClick={onNewChat}
            >
              <SquarePenIcon className="size-4" />
            </SidebarSectionHeaderAction>
          }
        />
        <CollapsiblePanel>
          <SidebarMenu className="gap-0.5 pt-1">
            <SidebarMenuItem className="rounded-md">
              <SidebarChatList
                listKey={chatListKey}
                threads={chatThreads}
                isThreadListExpanded={isChatListExpanded}
                activeRouteThreadKey={routeThreadKey}
                projectByKey={projectByKey}
                isScratchProject={isScratchProject}
                hideProjectIcons={activeFilter !== null}
                handleNewThread={handleNewThread}
                archiveThread={archiveThread}
                deleteThread={deleteThread}
                snoozeThread={snoozeThread}
                unsnoozeThread={unsnoozeThread}
                threadJumpLabelByKey={threadJumpLabelByKey}
                attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                expandThreadListForProject={expandThreadListForProject}
                collapseThreadListForProject={collapseThreadListForProject}
                onOpenProject={onOpenProject}
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
});

interface SidebarProjectsContentProps {
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateButtonAction: "download" | "install" | "none";
  desktopUpdateButtonDisabled: boolean;
  handleDesktopUpdateButtonClick: () => void;
  children: React.ReactNode;
}

function SidebarProjectsContent(props: SidebarProjectsContentProps) {
  const {
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    handleDesktopUpdateButtonClick,
    children,
  } = props;

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
          <WebFeatureNavigationItems slot="primary-after-project" />
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
      <SidebarGroup className="px-2 py-2">{children}</SidebarGroup>
    </SidebarContent>
  );
}

const ALL_PROJECTS_CHAT_LIST_KEY = "chats:all";

export default function Sidebar() {
  const projects = useProjects();
  const sidebarThreads = useThreadShells();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const sidebarThreadSortOrder = useClientSettings((s) => s.sidebarThreadSortOrder);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const handleNewThread = useNewThreadHandler();
  const { startScratchThread } = useScratchProject();
  const isScratchProject = useIsScratchProject();
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
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const sidebarProjectFilterKey = useUiStateStore((store) => store.sidebarProjectFilterKey);
  const setSidebarProjectFilterKey = useUiStateStore((store) => store.setSidebarProjectFilterKey);
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const desktopUpdateState = useDesktopUpdateState();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const sidebarProjects = useSidebarLogicalProjects();
  // Every project, scratch included: rows resolve their own and linked
  // projects through it.
  const projectByKey = useMemo(() => buildProjectIndex(projects), [projects]);

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
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      modelPickerOpen: isModelPickerOpen(),
    }),
    [],
  );
  const newChatShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "chat.new", { platform }),
    [keybindings, platform],
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
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, navigate, setOpenMobile, setSelectionAnchor],
  );

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
    const logicalKeyByProjectKey = new Map<string, string>();
    for (const project of sidebarProjects) {
      for (const memberRef of project.memberProjectRefs) {
        logicalKeyByProjectKey.set(scopedProjectKey(memberRef), project.projectKey);
      }
    }
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads.flatMap((thread) => {
      const logicalKey = logicalKeyByProjectKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      return logicalKey ? [{ ...thread, projectId: logicalKey as ProjectId }] : [];
    });
    const sidebarProjectByKey = new Map(
      sidebarProjects.map((project) => [project.projectKey, project] as const),
    );
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [sidebarProjectSortOrder, sidebarProjects, visibleThreads]);

  // The selection is only a filter: it never follows the open thread, and a
  // key that no longer resolves reads as "All projects" without being cleared.
  const activeFilter = useMemo(
    () => resolveSidebarProjectFilter(sidebarProjectFilterKey, sortedProjects),
    [sidebarProjectFilterKey, sortedProjects],
  );
  const chatThreads = useMemo(
    () =>
      filterThreadsByProjectRefs(visibleThreads, projectByKey, activeFilter?.projectRefs ?? null),
    [activeFilter, projectByKey, visibleThreads],
  );
  const chatListKey = activeFilter ? `chats:${activeFilter.key}` : ALL_PROJECTS_CHAT_LIST_KEY;
  const isChatListExpanded = expandedThreadListsByProject.has(chatListKey);

  const handleSelectFilter = useCallback(
    (projectKey: string | null) => {
      setSidebarProjectFilterKey(projectKey);
    },
    [setSidebarProjectFilterKey],
  );
  const handleOpenProject = useCallback(
    (projectRef: ScopedProjectRef) => {
      const projectKey = findLogicalProjectKeyForRef(projectRef, sortedProjects);
      if (projectKey === null) return;
      setSidebarProjectFilterKey(projectKey);
      setProjectsOpen(true);
      setChatsOpen(true);
    },
    [setSidebarProjectFilterKey, sortedProjects],
  );
  const handleNewChat = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void startScratchThread();
  }, [isMobile, setOpenMobile, startScratchThread]);

  const visibleSidebarThreadKeys = useMemo(() => {
    if (!chatsOpen) return [];
    const activeThreads = sortThreads(
      chatThreads.filter((thread) => !isThreadSnoozed(thread)),
      sidebarThreadSortOrder,
    );
    const renderedThreads =
      isChatListExpanded || activeThreads.length <= CHAT_LIST_PREVIEW_COUNT
        ? activeThreads
        : activeThreads.slice(0, CHAT_LIST_PREVIEW_COUNT);
    return renderedThreads.map((thread) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    );
  }, [chatThreads, chatsOpen, isChatListExpanded, isThreadSnoozed, sidebarThreadSortOrder]);
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
          >
            <UnifiedSidebarView
              projects={sortedProjects}
              activeFilter={activeFilter}
              onSelectFilter={handleSelectFilter}
              projectsOpen={projectsOpen}
              onProjectsOpenChange={setProjectsOpen}
              chatsOpen={chatsOpen}
              onChatsOpenChange={setChatsOpen}
              openAddProject={openAddProjectCommandPalette}
              newChatShortcutLabel={newChatShortcutLabel}
              onNewChat={handleNewChat}
              chatListKey={chatListKey}
              chatThreads={chatThreads}
              isChatListExpanded={isChatListExpanded}
              routeThreadKey={routeThreadKey}
              projectByKey={projectByKey}
              isScratchProject={isScratchProject}
              handleNewThread={handleNewThread}
              archiveThread={archiveThread}
              deleteThread={deleteThread}
              snoozeThread={snoozeThread}
              unsnoozeThread={unsnoozeThread}
              threadJumpLabelByKey={visibleThreadJumpLabelByKey}
              attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
              expandThreadListForProject={expandThreadListForProject}
              collapseThreadListForProject={collapseThreadListForProject}
              onOpenProject={handleOpenProject}
            />
          </SidebarProjectsContent>

          <SidebarChromeFooter />
        </>
      )}
    </>
  );
}
