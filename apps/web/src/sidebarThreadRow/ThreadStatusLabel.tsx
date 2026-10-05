import {
  resolveSidebarV2TopStatus,
  type SidebarThreadStatus,
  type SidebarV2TopStatusKind,
} from "../components/Sidebar.logic";
import { cn } from "../lib/utils";

/** Upstream's status kinds that have a text label. Woke has none: it stays hidden. */
export type ThreadStatusLabelKind = Exclude<SidebarV2TopStatusKind, "woke">;

export interface ThreadStatusLabelEntry {
  readonly kind: ThreadStatusLabelKind;
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
  working: { label: "Working", className: "text-info-foreground" },
  approval: { label: "Pending Approval", className: "text-warning-foreground" },
  input: { label: "Awaiting Input", className: "text-indigo-600 dark:text-indigo-300" },
  done: { label: "Completed", className: "text-success-foreground" },
  failed: { label: "Failed", className: "text-error-foreground" },
  limited: { label: "Limited", className: "text-warning-foreground" },
  waiting: { label: "Waiting", className: "text-muted-foreground" },
};

/** The label for a thread, from upstream's status derivation. */
export function resolveThreadStatusLabel(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
}): ThreadStatusLabelEntry | null {
  const kind = resolveSidebarV2TopStatus(input);
  if (kind === null || kind === "woke") return null;
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
