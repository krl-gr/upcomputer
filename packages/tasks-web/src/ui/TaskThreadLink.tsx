import { useMemo } from "react";
import { scopeThreadRef } from "@upcomputer/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@upcomputer/contracts";

import { useThreadDetail, useThreadStatus } from "../../../../apps/web/src/state/entities.ts";
import { derivePendingApprovals } from "../../../../apps/web/src/session-logic.ts";
import { formatSidebarThreadTimestamp } from "../../../../apps/web/src/components/Sidebar.logic.ts";
import {
  SIDEBAR_LABEL_COLOR_CLASS,
  SIDEBAR_LABEL_TEXT_CLASS,
  SIDEBAR_MUTED_TEXT_CLASS,
} from "../../../../apps/web/src/components/sidebar/sidebarTextStyles.ts";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { taskRunPresentation } from "./taskRunPresentation.ts";

export interface TaskThreadLinkProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly runStatus?: string;
  readonly timestamp?: string;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}

/**
 * A task-agent thread may be intentionally absent from the sidebar shell.
 * Subscribing to its detail before navigation gives the canonical chat route a
 * hydrated target instead of letting it classify the thread as missing and
 * fall back to the previously selected conversation.
 */
export function TaskThreadLink(props: TaskThreadLinkProps) {
  const threadRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const thread = useThreadDetail(threadRef);
  const status = useThreadStatus(threadRef);
  const available = thread !== null;
  const unavailable = status === "deleted";
  const hasPendingApproval = derivePendingApprovals(thread?.activities ?? []).length > 0;
  const runStatusPresentation = taskRunPresentation(props.runStatus, hasPendingApproval);
  const timestamp = props.timestamp ?? thread?.updatedAt ?? thread?.createdAt;
  const timeLabel = timestamp ? formatSidebarThreadTimestamp(timestamp) : null;

  return (
    <button
      type="button"
      disabled={!available}
      className={cn(
        "flex h-8 w-full min-w-0 translate-x-0 items-center overflow-hidden rounded-lg px-2 text-left text-foreground/72 select-none transition-colors dark:text-white/82",
        available
          ? "cursor-pointer hover:bg-accent hover:text-foreground dark:hover:text-white/92"
          : "cursor-wait opacity-70",
      )}
      onClick={() => available && props.onOpen(props.environmentId, props.threadId)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {runStatusPresentation ? (
          <span
            className={cn("shrink-0", SIDEBAR_LABEL_TEXT_CLASS, runStatusPresentation.className)}
          >
            {runStatusPresentation.label}
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            SIDEBAR_LABEL_COLOR_CLASS,
            SIDEBAR_LABEL_TEXT_CLASS,
          )}
        >
          {thread?.title || props.title}
        </span>
      </span>
      <span
        className={cn(
          "ml-auto shrink-0 pl-2 text-right",
          SIDEBAR_MUTED_TEXT_CLASS,
          SIDEBAR_LABEL_TEXT_CLASS,
        )}
      >
        {unavailable ? "Unavailable" : available ? timeLabel : "Loading…"}
      </span>
    </button>
  );
}
