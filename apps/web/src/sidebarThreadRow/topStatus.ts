import type { SidebarThreadStatus, SidebarV2TopStatusKind } from "../components/Sidebar.logic";

/** Upstream's kinds, plus worktree setup, which upstream's detailed row labels on its own. */
export type ThreadTopStatusKind = SidebarV2TopStatusKind | "preparing";

/** The status a compact thread row or a bot row names, or null for none. */
export function resolveSidebarV2TopStatus(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
}): ThreadTopStatusKind | null {
  if (input.status === "preparing") return "preparing";
  if (input.status === "working") return "working";
  if (input.status === "waiting") return "waiting";
  if (input.status === "approval") return "approval";
  if (input.status === "input" || input.status === "request") return input.status;
  if (input.status === "failed" || input.status === "limited") return input.status;
  if (input.isWoke) return "woke";
  return input.isUnread ? "done" : null;
}
