import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EllipsisIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { makeWorkspaceFileDropHandlers } from "../components/chat/workspaceFileDrop";
import { useThreadHasUnsentDraft } from "../composerDraftStore";
import {
  hasUnseenCompletion,
  resolveSidebarRowAccessibility,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../components/Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { ProductThreadRowAccessory } from "../product/ProductSlots";
import {
  SIDEBAR_LIST_ROW_INTRINSIC_SIZE,
  SIDEBAR_LIST_ROW_SPACING,
} from "../sidebarMetrics/sidebarMetrics";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { useUiStateStore } from "../uiStateStore";
import {
  SIDEBAR_LIST_ROW,
  SIDEBAR_LIST_ROW_ACTIVE,
  SIDEBAR_LIST_ROW_REST,
  SidebarListRowEnd,
  sidebarListRowActionClassName,
  sidebarListRowFadingLabelClassName,
  sidebarListRowTitleClassName,
} from "./sidebarListRow";
import { SidebarThreadProjectIcons } from "./SidebarThreadProjectIcons";
import { resolveThreadStatusLabel, ThreadStatusLabel } from "./ThreadStatusLabel";

type SweepAction = "settle" | "unsettle" | "unsnooze";

/**
 * The props of upstream's `SidebarThreadRow` this row reads. Upstream's list
 * passes the same props to either row, so it stays the one list.
 */
export interface SidebarCompactThreadRowProps {
  readonly thread: SidebarThreadSummary;
  /** "unsnooze" marks a row in the Snoozed shelf. */
  readonly variantAction: SweepAction;
  readonly sortable?:
    | Pick<
        ReturnType<typeof useSortable>,
        "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
      >
    | undefined;
  readonly sweepAction: SweepAction | null;
  readonly snoozeWakeLabelText: string | null;
  readonly isActive: boolean;
  /** The thread the route shows, open or not: its unsent message is the composer's. */
  readonly isRouteThread?: boolean | undefined;
  readonly jumpLabel: string | null;
  readonly project: EnvironmentProject | null;
  readonly projectDisplayName: string | null;
  readonly onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  readonly onThreadActivate: (threadRef: ScopedThreadRef) => void;
  readonly onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  readonly onRenameTitleChange: (title: string) => void;
  readonly onCommitRename: (
    threadRef: ScopedThreadRef,
    title: string,
    originalTitle: string,
  ) => void;
  readonly onCancelRename: () => void;
  readonly isRenaming: boolean;
  readonly renamingTitle: string;
  /** Upstream's thread actions menu, the same one right-click opens. */
  readonly onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  readonly onFileDropThreads?: ((threadRef: ScopedThreadRef, files: File[]) => void) | undefined;
  /** Upstream's route reveal: until the open thread's row mounts, its project scope may widen. */
  readonly revealRef?: ((row: HTMLElement, threadKey: string) => void) | undefined;
}

const MENU_CLOSING_KEYS = new Set(["Escape", "Enter", " ", "Tab"]);

/** Upstream's compact relative time ("3h", "now"). */
export function compactRelativeTimeLabel(iso: string): string {
  const label = formatRelativeTimeLabel(iso);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  return compactRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt);
}

/**
 * A one-line sidebar thread row: project icons, status, title, and the time,
 * which hover or keyboard focus swaps for a "…" button that opens upstream's
 * thread actions. The thread row accessory (task runs) keeps its place next
 * to the time. Selection, rename, drag and drop and jump hints work as on
 * upstream's row.
 */
export const SidebarCompactThreadRow = memo(function SidebarCompactThreadRow(
  props: SidebarCompactThreadRowProps,
) {
  const {
    thread,
    isRenaming,
    renamingTitle,
    sortable,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onFileDropThreads,
    onRenameTitleChange,
    onStartRename,
    onThreadActivate,
    onThreadClick,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isRouteThread;
  const statusLabel = resolveThreadStatusLabel({
    status: resolveSidebarThreadStatus(thread),
    isUnread,
    isWoke: false,
    hasUnsentDraft,
  });
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: statusLabel?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });

  // Upstream's menu is a native (or DOM fallback) menu that reports no close,
  // so the row stays highlighted until the next pointer press or a key that
  // closes a menu. Arrow keys move through the web fallback menu and keep it.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const closeOnKey = (event: KeyboardEvent) => {
      if (MENU_CLOSING_KEYS.has(event.key)) close();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", closeOnKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", closeOnKey, true);
    };
  }, [menuOpen]);
  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuOpen(true);
    onContextMenu(threadRef, { x: rect.left, y: rect.bottom + 4 });
  };

  const [titleTruncated, setTitleTruncated] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const measureTitle = () => {
    const element = titleRef.current;
    setTitleTruncated(element !== null && element.scrollWidth > element.clientWidth);
  };

  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      renameCommittedRef.current = true;
      onCommitRename(threadRef, renamingTitle, thread.title);
    } else if (event.key === "Escape") {
      event.preventDefault();
      renameCommittedRef.current = true;
      onCancelRename();
    }
  };

  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = onFileDropThreads
    ? makeWorkspaceFileDropHandlers({
        setDragActive: setIsFileDragOver,
        addFiles: (files) => onFileDropThreads(threadRef, files),
        addFolders: () => {},
      })
    : null;
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);

  const { revealRef } = props;
  const rootRef = (row: HTMLElement | null) => {
    if (row !== null) revealRef?.(row, threadKey);
    sortable?.setNodeRef(row);
  };
  const sortableRootProps = sortable
    ? {
        style: {
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
          // Same sentinel as upstream's row: projected peers scale to zero.
          visibility:
            !sortable.isDragging && sortable.transform?.scaleY === 0
              ? ("hidden" as const)
              : undefined,
        },
        ...sortable.listeners,
      }
    : {};
  const isSnoozedRow = props.variantAction === "unsnooze" && props.snoozeWakeLabelText !== null;

  return (
    <li
      ref={rootRef}
      data-thread-item={threadKey}
      {...sortableRootProps}
      {...(fileDropHandlers ?? {})}
      className={cn(
        "list-none [content-visibility:auto]",
        SIDEBAR_LIST_ROW_INTRINSIC_SIZE,
        SIDEBAR_LIST_ROW_SPACING,
        sortable?.isDragging && "relative z-20",
      )}
    >
      <Tooltip disabled={!titleTruncated || menuOpen || isRenaming || sortable?.isDragging}>
        <TooltipTrigger
          render={
            <div
              role="button"
              tabIndex={0}
              aria-label={accessibility.label}
              aria-current={accessibility.current}
              aria-busy={thread.titleRegeneration != null || undefined}
              data-testid="sidebar-row-compact"
              className={cn(
                SIDEBAR_LIST_ROW,
                props.isActive
                  ? SIDEBAR_LIST_ROW_ACTIVE
                  : isSelected || props.sweepAction !== null
                    ? "bg-sidebar-row-selected text-sidebar-foreground"
                    : menuOpen || isFileDragOver
                      ? "bg-sidebar-row-hover text-sidebar-foreground"
                      : SIDEBAR_LIST_ROW_REST,
                isFileDragOver && "ring-1 ring-inset ring-primary/70",
                sortable?.isDragging &&
                  "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active opacity-100 shadow-lg",
              )}
              onPointerEnter={measureTitle}
              onFocus={measureTitle}
              onClick={(event) => onThreadClick(event, threadRef)}
              onDoubleClick={(event) => {
                if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey) return;
                if (event.altKey) return;
                if ((event.target as HTMLElement).closest("button, a, input")) return;
                event.preventDefault();
                onStartRename(threadRef, thread.title);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onThreadActivate(threadRef);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
              }}
            />
          }
        >
          <SidebarThreadProjectIcons thread={thread} project={props.project} />
          <ThreadStatusLabel status={statusLabel} />
          {isRenaming ? (
            <input
              autoFocus
              value={renamingTitle}
              aria-label="Thread title"
              onChange={(event) => onRenameTitleChange(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={handleRenameKeyDown}
              onBlur={() => {
                if (!renameCommittedRef.current) {
                  onCommitRename(threadRef, renamingTitle, thread.title);
                }
              }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm text-card-foreground outline-none focus:border-foreground"
            />
          ) : (
            <span
              ref={titleRef}
              aria-hidden
              className={cn(
                sidebarListRowTitleClassName(props.isActive),
                thread.titleRegeneration != null && "opacity-55",
              )}
            >
              {thread.title}
            </span>
          )}
          <SidebarListRowEnd
            pinned={menuOpen}
            action={
              <button
                type="button"
                data-thread-selection-safe
                aria-label={`Thread actions for ${thread.title}`}
                className={sidebarListRowActionClassName(menuOpen)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={openMenu}
              >
                <EllipsisIcon />
              </button>
            }
          >
            {props.jumpLabel ? (
              // Held jump keys name the shortcut where the time is, in the time's style.
              <span data-fading-label className={sidebarListRowFadingLabelClassName(menuOpen)}>
                {props.jumpLabel}
              </span>
            ) : isSnoozedRow ? (
              <span
                data-fading-label
                className={cn("text-info-foreground", sidebarListRowFadingLabelClassName(menuOpen))}
              >
                {props.snoozeWakeLabelText}
              </span>
            ) : (
              <ProductThreadRowAccessory
                environmentId={thread.environmentId}
                threadId={thread.id}
                fallback={
                  <span data-fading-label className={sidebarListRowFadingLabelClassName(menuOpen)}>
                    {threadTimeLabel(thread)}
                  </span>
                }
              />
            )}
          </SidebarListRowEnd>
          {thread.titleRegeneration != null ? (
            <span role="status" className="sr-only">
              Regenerating title
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="top">{thread.title}</TooltipPopup>
      </Tooltip>
    </li>
  );
});
