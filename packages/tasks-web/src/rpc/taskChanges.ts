import type { TaskChange } from "@t3tools/tasks-contracts/v1";

export type TaskChangeListener = (change: TaskChange) => void;
export type SubscribeTaskChanges = (
  listener: TaskChangeListener,
  onError?: (error: unknown) => void,
) => () => void;

/** One stream per environment, shared by the list and selected task details. */
export function createTaskChangeSubscription(
  open: (signal: AbortSignal, listener: TaskChangeListener) => Promise<void>,
  retryDelay = 1_000,
): SubscribeTaskChanges {
  const listeners = new Map<TaskChangeListener, ((error: unknown) => void) | undefined>();
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSequence: number | undefined;
  let connected = false;
  let attempts = 0;
  const sync = (sequence: number): TaskChange => ({
    kind: "sync",
    sequence,
    taskIds: [],
    rootThreadIds: [],
    listChanged: true,
    runsChanged: true,
  });
  const start = () => {
    const active = new AbortController();
    controller = active;
    void open(active.signal, (event) => {
      if (active.signal.aborted) return;
      const gap =
        event.kind !== "sync" &&
        (lastSequence === undefined || event.sequence !== lastSequence + 1);
      if (event.kind !== "sync" && lastSequence !== undefined && event.sequence <= lastSequence)
        return;
      lastSequence = event.sequence;
      connected = true;
      attempts = 0;
      for (const listener of listeners.keys()) listener(gap ? sync(event.sequence) : event);
    }).then(
      () => retry(new Error("Task change stream disconnected.")),
      (error) => retry(error),
    );
    function retry(error: unknown) {
      if (active.signal.aborted || listeners.size === 0) return;
      connected = false;
      for (const onError of listeners.values()) onError?.(error);
      // Backoff only on connection failures, never periodic data polling.
      timer = setTimeout(start, Math.min(retryDelay * 2 ** attempts++, 30_000));
    }
  };
  return (listener, onError) => {
    listeners.set(listener, onError);
    if (listeners.size === 1) start();
    else if (connected)
      queueMicrotask(() => {
        if (listeners.has(listener) && connected) listener(sync(lastSequence!));
      });
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        controller?.abort();
        clearTimeout(timer);
        connected = false;
        lastSequence = undefined;
        attempts = 0;
      }
    };
  };
}
