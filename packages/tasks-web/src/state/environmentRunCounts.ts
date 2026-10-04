import type { TaskChange, TaskRunCount } from "@t3tools/tasks-contracts/v1";
import type { TasksWebRpcClient } from "../rpc/tasksRpcClient.ts";

const EMPTY: readonly TaskRunCount[] = [];

/**
 * One environment's run counts over all tasks, for the Tasks navigation entry.
 * Reloads on run changes from the shared task stream; no polling.
 */
export class EnvironmentRunCountsStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly TaskRunCount[] = EMPTY;
  private stop: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private stale = false;
  private generation = 0;
  private failures = 0;
  private readonly client: TasksWebRpcClient;
  private readonly batchMs: number;
  constructor(client: TasksWebRpcClient, batchMs = 150) {
    this.client = client;
    this.batchMs = batchMs;
  }

  get = (): readonly TaskRunCount[] => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.stop) {
      this.stop = this.client.tasks.subscribe(this.changed);
      this.refresh();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.stop?.();
      this.stop = undefined;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.generation++;
      this.busy = false;
      this.stale = false;
      this.failures = 0;
      this.snapshot = EMPTY;
    };
  };

  private refresh() {
    this.stale = true;
    this.schedule();
  }

  private changed = (event: TaskChange) => {
    if (event.kind === "sync" || event.runsChanged) this.refresh();
  };

  private schedule(delay = this.batchMs) {
    if (this.timer || this.busy || !this.stale) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  private async flush() {
    const generation = this.generation;
    // A change during the request must be read again, not consumed with this snapshot.
    this.stale = false;
    this.busy = true;
    try {
      const { runCounts } = await this.client.tasks.runCounts({});
      if (generation !== this.generation) return;
      this.failures = 0;
      if (JSON.stringify(runCounts) === JSON.stringify(this.snapshot)) return;
      this.snapshot = runCounts;
      for (const listener of this.listeners) listener();
    } catch {
      if (generation !== this.generation) return;
      this.stale = true;
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

const stores = new WeakMap<TasksWebRpcClient, EnvironmentRunCountsStore>();
export function environmentRunCountsStore(client: TasksWebRpcClient) {
  let store = stores.get(client);
  if (!store) {
    store = new EnvironmentRunCountsStore(client);
    stores.set(client, store);
  }
  return store;
}
