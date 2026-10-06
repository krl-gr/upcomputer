import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EllipsisIcon, PinIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { makeWorkspaceFileDropHandlers } from "../components/chat/workspaceFileDrop";
import {
  hasUnseenCompletion,
  resolveSidebarRowAccessibility,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  type SidebarDropVerb,
} from "../components/Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { ProductThreadRowAccessory } from "../product/ProductSlots";
import {
  SIDEBAR_ACTION_BUTTON,
  SIDEBAR_ICON_GAP,
  SIDEBAR_LIST_ROW_INTRINSIC_SIZE,
  SIDEBAR_LIST_ROW_SPACING,
  SIDEBAR_ROW_HEIGHT,
  SIDEBAR_ROW_INSET,
  SIDEBAR_ROW_TEXT,
} from "../sidebarMetrics/sidebarMetrics";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { useUiStateStore } from "../uiStateStore";
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
  readonly isPinned: boolean;
  readonly sortable?:
    | Pick<
        ReturnType<typeof useSortable>,
        "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
      >
    | undefined;
  readonly dropVerb: SidebarDropVerb | null;
  readonly sweepAction: SweepAction | null;
  readonly snoozeWakeLabelText: string | null;
  readonly isActive: boolean;
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
}

const DROP_VERB_LABELS: Record<SidebarDropVerb, string> = {
  pin: "Pin",
  unpin: "Unpin",
  settle: "Settle",
  unsettle: "Un-settle",
  wake: "Wake",
};

// Hover, or keyboard focus on the row or on its button, swaps the time for the
// "…" button. Keyboard focus only: a clicked row keeps focus and would pin it.
const FADE_WHEN_REVEALED =
  "group-any-hover/sidebar-row:opacity-0 group-focus-visible/sidebar-row:opacity-0 group-has-[:focus-visible]/sidebar-row:opacity-0";
const MAKE_ROOM_WHEN_REVEALED =
  "group-any-hover/sidebar-row:not-has-[[data-fading-label]]:pr-6 group-focus-visible/sidebar-row:not-has-[[data-fading-label]]:pr-6 group-has-[:focus-visible]/sidebar-row:not-has-[[data-fading-label]]:pr-6";
const SHOW_WHEN_REVEALED =
  "pointer-events-none opacity-0 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100 group-focus-visible/sidebar-row:pointer-events-auto group-focus-visible/sidebar-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100";

const MENU_CLOSING_KEYS = new Set(["Escape", "Enter", " ", "Tab"]);

/** Upstream's compact relative time ("3h", "now"). */
function threadTimeLabel(thread: SidebarThreadSummary): string {
  const label = formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
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
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const statusLabel = resolveThreadStatusLabel({
    status: resolveSidebarThreadStatus(thread),
    isUnread,
    isWoke: false,
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
  const fileDropHandlers = useMemo(
    () =>
      onFileDropThreads
        ? makeWorkspaceFileDropHandlers({
            setDragActive: setIsFileDragOver,
            addFiles: (files) => onFileDropThreads(threadRef, files),
            addFolders: () => {},
          })
        : null,
    [onFileDropThreads, threadRef],
  );
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);

  const sortableRootProps = sortable
    ? {
        ref: sortable.setNodeRef,
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
  const destinationVerb = sortable?.isDragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const isSnoozedRow = props.variantAction === "unsnooze" && props.snoozeWakeLabelText !== null;

  return (
    <li
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
                "group/sidebar-row relative flex w-full cursor-pointer items-center overflow-hidden rounded-md text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                SIDEBAR_ROW_HEIGHT,
                SIDEBAR_ICON_GAP,
                SIDEBAR_ROW_INSET,
                props.isActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : isSelected || props.sweepAction !== null
                    ? "bg-sidebar-row-selected text-sidebar-foreground"
                    : menuOpen || isFileDragOver
                      ? "bg-sidebar-row-hover text-sidebar-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-row-hover",
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
                // One tone for every title, as V1: unread and statuses show
                // only through the status label.
                "min-w-0 flex-1 truncate text-sm",
                props.isActive
                  ? "text-foreground"
                  : cn(SIDEBAR_ROW_TEXT, "group-hover/sidebar-row:text-foreground"),
                thread.titleRegeneration != null && "opacity-55",
              )}
            >
              {thread.title}
            </span>
          )}
          {destinationVerb != null ? (
            <span
              role="status"
              className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
            >
              {DROP_VERB_LABELS[destinationVerb]}
            </span>
          ) : (
            <span className="relative ml-auto flex h-6 shrink-0 items-center">
              {/* The time fades under the "…" button. An accessory that replaces
                  the time (task runs) stays, and the block moves left instead. */}
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-sm tabular-nums text-secondary-label",
                  menuOpen ? "pr-6" : MAKE_ROOM_WHEN_REVEALED,
                )}
              >
                {props.isPinned ? (
                  <PinIcon
                    role="img"
                    aria-label="Pinned"
                    className="size-3 shrink-0 text-muted-foreground/65"
                  />
                ) : null}
                {isSnoozedRow ? (
                  <span
                    data-fading-label
                    className={cn(
                      "text-info-foreground",
                      menuOpen ? "opacity-0" : FADE_WHEN_REVEALED,
                    )}
                  >
                    {props.snoozeWakeLabelText}
                  </span>
                ) : (
                  <ProductThreadRowAccessory
                    environmentId={thread.environmentId}
                    threadId={thread.id}
                    fallback={
                      <span
                        data-fading-label
                        className={menuOpen ? "opacity-0" : FADE_WHEN_REVEALED}
                      >
                        {threadTimeLabel(thread)}
                      </span>
                    }
                  />
                )}
              </span>
              <button
                type="button"
                data-thread-selection-safe
                aria-label={`Thread actions for ${thread.title}`}
                className={cn(
                  "absolute inset-y-0 right-0 my-auto",
                  SIDEBAR_ACTION_BUTTON,
                  menuOpen ? "opacity-100" : SHOW_WHEN_REVEALED,
                )}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={openMenu}
              >
                <EllipsisIcon className="size-4" />
              </button>
            </span>
          )}
          {thread.titleRegeneration != null ? (
            <span role="status" className="sr-only">
              Regenerating title
            </span>
          ) : null}
          {props.jumpLabel ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-3xs font-medium tracking-tight text-foreground shadow-sm"
            >
              {props.jumpLabel}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="top">{thread.title}</TooltipPopup>
      </Tooltip>
    </li>
  );
});
