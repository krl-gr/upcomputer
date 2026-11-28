import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { threadRunCountsStore } from "@t3tools/tasks-client/state/threadRunCounts";
import type { TaskRunCount } from "@t3tools/tasks-contracts/v1";
import { useMessages } from "gt-react-native";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { taskRunCounts } from "./taskPresentation";
import { readTasksClient, useTasksAccess } from "./tasksRpc";

const NO_COUNTS: readonly TaskRunCount[] = [];

/** How long a person must look at a thread before leaving it marks its runs seen, as on the desktop. */
const SEEN_DWELL_MS = 1000;

function useThreadRunCountsStore(environmentId: EnvironmentId) {
  const readable = useTasksAccess(environmentId)?.canReadTasks === true;
  return readable ? threadRunCountsStore(readTasksClient(environmentId)) : null;
}

/**
 * The desktop sidebar row's run counts for a thread: its tasks' active runs, and finished runs
 * since the thread was last looked at, by state in the desktop's order.
 */
export function useThreadRunCounts(environmentId: EnvironmentId, threadId: ThreadId) {
  const messages = useMessages();
  const store = useThreadRunCountsStore(environmentId);
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(threadId, listener) : () => undefined),
    [store, threadId],
  );
  const read = () => (store ? store.get(threadId) : NO_COUNTS);
  return taskRunCounts(useSyncExternalStore(subscribe, read, read), messages);
}

/** Run counts as the desktop's sidebar draws them: bare numbers in their state's colour. */
export function ThreadRunCountNumbers(props: {
  readonly counts: ReturnType<typeof useThreadRunCounts>;
  /** One colour for every number, such as a selected row's. */
  readonly colorClassName?: string;
}) {
  return (
    <View className="shrink-0 flex-row items-center gap-1.5">
      {props.counts.map((count) => (
        <Text
          key={count.label}
          className={cn(
            "text-base font-t3-medium tabular-nums",
            props.colorClassName ?? count.text,
          )}
        >
          {count.count}
        </Text>
      ))}
    </View>
  );
}

/**
 * Marks the open thread's finished runs seen when the person stops looking at it: they leave the
 * thread or the app goes to the background, after a look of at least `SEEN_DWELL_MS`.
 */
export function ThreadRunsSeen(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const store = useThreadRunCountsStore(props.environmentId);
  const { threadId } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the app's foreground state and the thread's mount to tell the server when its runs were seen
  useEffect(() => {
    if (!store) return;
    // Following the thread keeps its counts in the store until the last check below.
    const unfollow = store.subscribe(threadId, () => undefined);
    let lookingSince: number | null = AppState.currentState === "active" ? Date.now() : null;
    const end = () => {
      if (lookingSince === null) return;
      const looked = Date.now() - lookingSince >= SEEN_DWELL_MS;
      lookingSince = null;
      if (looked) store.markSeen(threadId);
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") end();
      else if (lookingSince === null) lookingSince = Date.now();
    });
    return () => {
      subscription.remove();
      end();
      unfollow();
    };
  }, [store, threadId]);
  return null;
}
