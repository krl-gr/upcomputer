import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { msg } from "gt-react-native";

import {
  resolveThreadListV2RowStatus,
  threadHasUnseenCompletion,
  type ThreadListV2Status,
} from "../../threads/threadListV2";

export interface SidebarStatusWord {
  readonly label: string;
  readonly className: string;
}

/** The desktop sidebar's status words (`THREAD_STATUS_LABELS`), in the phone's matching colors. */
const STATUS_WORDS: Partial<Record<ThreadListV2Status, SidebarStatusWord>> = {
  working: {
    label: msg("Working", { $context: "thread status" }),
    className: "text-adaptive-sky-600-400",
  },
  approval: {
    label: msg("Pending Approval", { $context: "thread status" }),
    className: "text-warning-foreground",
  },
  input: {
    label: msg("Awaiting Input", { $context: "thread status" }),
    className: "text-adaptive-indigo-600-300",
  },
  request: {
    label: msg("Guest Request", { $context: "thread status" }),
    className: "text-adaptive-fuchsia-600-300",
  },
  limited: {
    label: msg("Limited", { $context: "thread status, usage limit reached" }),
    className: "text-warning-foreground",
  },
  failed: {
    label: msg("Failed", { $context: "thread status" }),
    className: "text-danger-foreground",
  },
  waiting: {
    label: msg("Waiting", { $context: "thread status" }),
    className: "text-foreground-muted",
  },
};

const COMPLETED: SidebarStatusWord = {
  label: msg("Completed", { $context: "thread status" }),
  className: "text-adaptive-emerald-700-300",
};

/** The word before a thread's title, as marked text: none for a quiet one, Completed only unread. */
export function sidebarThreadStatusWord(thread: EnvironmentThreadShell): SidebarStatusWord | null {
  const status = resolveThreadListV2RowStatus(thread);
  if (status === "ready") return threadHasUnseenCompletion(thread) ? COMPLETED : null;
  return STATUS_WORDS[status] ?? null;
}
