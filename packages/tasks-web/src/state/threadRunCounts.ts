import type { ThreadId } from "@t3tools/contracts";
import type { TaskChange, TaskRunCount } from "@t3tools/tasks-contracts/v1";
import type { TasksWebRpcClient } from "../rpc/tasksRpcClient.ts";

const EMPTY: readonly TaskRunCount[] = [];
/** Shared per environment client, independent of the Tasks route. No polling or per-row requests. */
export class ThreadRunCountsStore {
  private readonly listeners = new Map<ThreadId, Set<() => void>>();
  private readonly snapshots = new Map<ThreadId, readonly TaskRunCount[]>();
  private readonly pending = new Set<ThreadId>();
  private stop: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private generation = 0;
  private failures = 0;
  private readonly client: TasksWebRpcClient;
  private readonly batchMs: number;
  constructor(client: TasksWebRpcClient, batchMs = 150) {
    this.client = client;
    this.batchMs = batchMs;
  }

  get = (id: ThreadId): readonly TaskRunCount[] => this.snapshots.get(id) ?? EMPTY;

  subscribe = (id: ThreadId, listener: () => void) => {
    const callbacks = this.listeners.get(id) ?? new Set();
    callbacks.add(listener);
    this.listeners.set(id, callbacks);
    this.pending.add(id);
    if (!this.stop) this.stop = this.client.tasks.subscribe(this.changed);
    this.schedule();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      callbacks.delete(listener);
      if (callbacks.size === 0) {
        this.listeners.delete(id);
        this.snapshots.delete(id);
        this.pending.delete(id);
      }
      if (this.listeners.size === 0) {
        this.stop?.();
        this.stop = undefined;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.generation++;
        this.busy = false;
        this.failures = 0;
      }
    };
  };

  refresh = () => {
    for (const id of this.listeners.keys()) this.pending.add(id);
    this.schedule();
  };

  private changed = (event: TaskChange) => {
    if (event.kind === "sync") return this.refresh();
    if (!event.runsChanged) return;
    for (const id of event.rootThreadIds) if (this.listeners.has(id)) this.pending.add(id);
    this.schedule();
  };

  private schedule(delay = this.batchMs) {
    if (this.timer || this.busy || this.pending.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  private async flush() {
    const generation = this.generation;
    const ids = [...this.pending].slice(0, 500);
    for (const id of ids) this.pending.delete(id);
    this.busy = true;
    try {
      const result = await this.client.tasks.threadRunCounts({ threadIds: ids });
      if (generation !== this.generation) return;
      const rows = new Map(result.threads.map((row) => [row.threadId, row.runCounts]));
      for (const id of ids) {
        if (!this.listeners.has(id)) continue;
        // A change during the request must be read again, not consumed with this snapshot.
        const next = rows.get(id) ?? EMPTY;
        if (JSON.stringify(next) === JSON.stringify(this.get(id))) continue;
        this.snapshots.set(id, next);
        for (const callback of this.listeners.get(id) ?? []) callback();
      }
      this.failures = 0;
    } catch {
      if (generation !== this.generation) return;
      for (const id of ids) if (this.listeners.has(id)) this.pending.add(id);
      this.failures++;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.schedule(
          this.failures ? Math.min(1000 * 2 ** (this.failures - 1), 30000) : this.batchMs,
        );
      }
    }
  }
}

const stores = new WeakMap<TasksWebRpcClient, ThreadRunCountsStore>();
export function threadRunCountsStore(client: TasksWebRpcClient) {
  let store = stores.get(client);
  if (!store) {
    store = new ThreadRunCountsStore(client);
    stores.set(client, store);
  }
  return store;
}
