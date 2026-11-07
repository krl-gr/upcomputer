import type { SidebarThreadStatus } from "../components/Sidebar.logic";
import { resolveSidebarV2TopStatus, type ThreadTopStatusKind } from "./topStatus";
import { cn } from "../lib/utils";

/** Upstream's status kinds that have a text label. Woke has none: it stays hidden. */
export type ThreadStatusLabelKind = Exclude<ThreadTopStatusKind, "woke">;

export interface ThreadStatusLabelEntry {
  /** "draft": a typed, unsent message, named only when no status applies. */
  readonly kind: ThreadStatusLabelKind | "draft";
  readonly label: string;
  readonly className: string;
}

/**
 * V1's text statuses for upstream's status kinds, with V1's hues in theme
 * tokens where one exists. A new upstream kind fails typecheck here until it
 * has a label.
 */
export const THREAD_STATUS_LABELS: {
  readonly [Kind in ThreadStatusLabelKind]: Omit<ThreadStatusLabelEntry, "kind">;
} = {
  // Upstream's word for worktree setup, in Working's hue.
  preparing: { label: "Setting up", className: "text-info-foreground" },
  working: { label: "Working", className: "text-info-foreground" },
  approval: { label: "Pending Approval", className: "text-warning-foreground" },
  input: { label: "Awaiting Input", className: "text-indigo-600 dark:text-indigo-300" },
  request: { label: "Guest Request", className: "text-guest-foreground" },
  done: { label: "Completed", className: "text-success-foreground" },
  failed: { label: "Failed", className: "text-error-foreground" },
  limited: { label: "Limited", className: "text-warning-foreground" },
  waiting: { label: "Waiting", className: "text-muted-foreground" },
};

/** A draft's label: as quiet as Waiting. */
export const DRAFT_STATUS_LABEL: ThreadStatusLabelEntry = {
  kind: "draft",
  label: "Draft",
  className: "text-muted-foreground",
};

/**
 * The label for a thread, from upstream's status derivation. A typed, unsent
 * message shows "Draft" only when the thread has no status of its own.
 */
export function resolveThreadStatusLabel(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  readonly hasUnsentDraft?: boolean;
}): ThreadStatusLabelEntry | null {
  const kind = resolveSidebarV2TopStatus(input);
  if (kind === null || kind === "woke") return input.hasUnsentDraft ? DRAFT_STATUS_LABEL : null;
  return { kind, ...THREAD_STATUS_LABELS[kind] };
}

/**
 * A thread's status as coloured text, as V1 showed it: no icon, no dot and no
 * animation, so it costs nothing under the sidebar's backdrop blur. It takes
 * the font size of where it sits. Used by the compact rows and, under the
 * UpComputer surface, by upstream's detailed rows.
 */
export function ThreadStatusLabel(props: { readonly status: ThreadStatusLabelEntry | null }) {
  if (props.status === null) return null;
  return (
    <span
      role="status"
      data-testid="sidebar-row-status"
      data-status={props.status.kind}
      className={cn("shrink-0 whitespace-nowrap", props.status.className)}
    >
      {props.status.label}
    </span>
  );
}
