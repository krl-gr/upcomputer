/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import { useMemo } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { formatRelativeTimeLabel } from "../../../../apps/web/src/timestampFormat.ts";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { taskRunPresentation } from "./taskRunPresentation.ts";

export interface TaskThreadLinkProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Shown until the thread title loads. */
  readonly title: string;
  /** Shown instead of the thread title, e.g. the agent name on a task's own runs. */
  readonly label?: string;
  /** A second line under the label, e.g. the harness and model. */
  readonly detail?: string;
  readonly runStatus?: string;
  readonly timestamp?: string;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}

const LABEL_TEXT_CLASS = "text-sm font-normal leading-relaxed tracking-normal";
const LABEL_COLOR_CLASS = "text-foreground dark:text-white/82";
const MUTED_TEXT_CLASS = "text-muted-foreground dark:text-white/50";

/**
 * A task-agent thread is hidden from thread lists but keeps its shell, so the
 * link reads its title and status there and the chat route opens it directly.
 */
export function TaskThreadLink(props: TaskThreadLinkProps) {
  const threadRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const thread = useThreadShell(threadRef);
  const available = thread !== null && thread.deletedAt === null;
  const unavailable = thread?.deletedAt != null;
  const runStatusPresentation = taskRunPresentation(
    props.runStatus,
    thread?.hasPendingApprovals ?? false,
  );
  const timestamp = props.timestamp ?? thread?.updatedAt ?? thread?.createdAt;
  const timeLabel = timestamp ? formatRelativeTimeLabel(timestamp) : null;
  const label = props.label ?? (thread?.title || props.title);

  return (
    <button
      type="button"
      disabled={!available}
      title={props.detail ? `${label} · ${props.detail}` : undefined}
      className={cn(
        "flex w-full min-w-0 translate-x-0 overflow-hidden rounded-lg px-2 text-left text-foreground/72 select-none transition-colors dark:text-white/82",
        props.detail ? "items-start py-1" : "h-8 items-center",
        available
          ? "cursor-pointer hover:bg-accent hover:text-foreground dark:hover:text-white/92"
          : "cursor-wait opacity-70",
      )}
      onClick={() => available && props.onOpen(props.environmentId, props.threadId)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          {runStatusPresentation ? (
            <span className={cn("shrink-0", LABEL_TEXT_CLASS, runStatusPresentation.className)}>
              {runStatusPresentation.label}
            </span>
          ) : null}
          <span className={cn("min-w-0 flex-1 truncate", LABEL_COLOR_CLASS, LABEL_TEXT_CLASS)}>
            {label}
          </span>
        </span>
        {props.detail ? (
          <span className={cn("min-w-0 truncate", MUTED_TEXT_CLASS, LABEL_TEXT_CLASS)}>
            {props.detail}
          </span>
        ) : null}
      </span>
      <span className={cn("ml-auto shrink-0 pl-2 text-right", MUTED_TEXT_CLASS, LABEL_TEXT_CLASS)}>
        {unavailable ? "Unavailable" : available ? timeLabel : "Loading…"}
      </span>
    </button>
  );
}
