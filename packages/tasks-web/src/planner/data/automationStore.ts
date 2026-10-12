/**
 * One environment's automations for the planner: the agents' routines in the
 * Routines list (Agents, All) and the automation windows. Automations have no
 * change stream of their own, so the list is read again when tasks change (a
 * fire creates one, a delete changes a count) and shortly after the earliest
 * enabled automation is due. Writes merge their answer at once; a reorder
 * shows its order until the server answers.
 */
import type {
  TaskAutomation,
  TaskAutomationId,
  TaskAutomationListItem,
  TaskAutomationStatus,
  TaskAutomationUpsertInput,
  TaskChange,
} from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../../rpc/index.ts";
import { reuseRows } from "../../state/recent.ts";

export interface AutomationSnapshot {
  /** In the person's order. */
  readonly automations: readonly TaskAutomationListItem[];
  /** Loading until the first read answers. */
  readonly status: "loading" | "ready";
  readonly error: string | null;
}

/** Where a moved automation goes; neither neighbor is the top. */
export interface AutomationAnchor {
  readonly beforeAutomationId?: string;
  readonly afterAutomationId?: string;
}

export interface AutomationStoreOptions {
  readonly batchMs?: number;
  /** How long the store stays live after its last release. */
  readonly releaseMs?: number;
  readonly onError?: (title: string, error: unknown) => void;
  readonly now?: () => number;
  /** How long after a due run the list is read again (the scheduler ticks every 30 s). */
  readonly afterDueMs?: number;
}

/** Search reads every automation; one project holds at most 20 drafts. */
const SEARCH_LIMIT = 500;
const MAX_TIMER_MS = 2_147_483_647;

/** The person's order (rank); a server without ranks keeps its own order. */
export function orderAutomations<T extends Pick<TaskAutomation, "id" | "rank">>(
  rows: readonly T[],
): readonly T[] {
  if (rows.some((row) => row.rank === undefined)) return rows;
  return rows.toSorted(
    (left, right) => left.rank!.localeCompare(right.rank!) || left.id.localeCompare(right.id),
  );
}

/** `ids` with `id` moved next to its anchor, or first without one, as the server moves it. */
export function moveAutomationId(
  ids: readonly string[],
  id: string,
  anchor: AutomationAnchor,
): readonly string[] {
  const rest = ids.filter((candidate) => candidate !== id);
  const before = anchor.beforeAutomationId ? rest.indexOf(anchor.beforeAutomationId) : -1;
  const after = anchor.afterAutomationId ? rest.indexOf(anchor.afterAutomationId) : -1;
  const index = before >= 0 ? before : after >= 0 ? after + 1 : 0;
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The request failed.";
}

export class AutomationStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: AutomationSnapshot | null = null;
  private rows: readonly TaskAutomationListItem[] = [];
  private loaded = false;
  private error: string | null = null;
  /** The order a reorder shows until its answer is merged. */
  private pendingOrder: { readonly op: number; readonly ids: readonly string[] } | null = null;
  private nextOp = 1;
  /** Counts merged writes; a read that started before one is read again. */
  private writes = 0;
  private reading = false;
  private readAgain = false;
  private retained = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dueTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly client: TasksWebRpcClient;
  private readonly batchMs: number;
  private readonly releaseMs: number;
  private readonly onError: (title: string, error: unknown) => void;
  private readonly now: () => number;
  private readonly afterDueMs: number;

  constructor(client: TasksWebRpcClient, options: AutomationStoreOptions = {}) {
    this.client = client;
    this.batchMs = options.batchMs ?? 500;
    this.releaseMs = options.releaseMs ?? 1_000;
    this.onError = options.onError ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.afterDueMs = options.afterDueMs ?? 35_000;
  }

  // ---- subscription -------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AutomationSnapshot => {
    this.snapshot ??= this.derive();
    return this.snapshot;
  };

  private emit() {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  /** Keeps the list live while a list or window shows it; data stays cached after release. */
  retain(): () => void {
    this.retained += 1;
    if (this.retained === 1) {
      // Retained again within the grace (the Tasks panel remounting with a
      // thread switch): still live, so nothing is read again.
      if (this.releaseTimer !== undefined) clearTimeout(this.releaseTimer);
      else this.start();
      this.releaseTimer = undefined;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retained -= 1;
      if (this.retained === 0)
        this.releaseTimer = setTimeout(() => {
          this.releaseTimer = undefined;
          this.stop();
        }, this.releaseMs);
    };
  }

  /** Following the change stream: retained, or released less than `releaseMs` ago. */
  private get live() {
    return this.retained > 0 || this.releaseTimer !== undefined;
  }

  private start() {
    this.unsubscribe = this.client.tasks.subscribe((change: TaskChange) => {
      if (change.kind === "sync" || change.listChanged) this.schedule(this.batchMs);
    });
    this.schedule(0);
  }

  private stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    clearTimeout(this.dueTimer);
    this.dueTimer = undefined;
  }

  private schedule(delay: number) {
    if (this.timer !== undefined) {
      if (delay > 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.read();
    }, delay);
  }

  private async read() {
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    const start = this.writes;
    try {
      const { automations } = await this.client.automations.search({ limit: SEARCH_LIMIT });
      if (this.writes !== start) this.readAgain = true;
      else {
        this.rows = reuseRows(this.rows, automations, (row) => row.id);
        this.error = null;
      }
    } catch (error) {
      this.error = errorText(error);
    } finally {
      this.loaded = true;
      this.reading = false;
      this.armDue();
      this.emit();
      if (this.readAgain) {
        this.readAgain = false;
        if (this.live) this.schedule(0);
      }
    }
  }

  /** Reads again a little after the earliest enabled automation is due. */
  private armDue() {
    clearTimeout(this.dueTimer);
    this.dueTimer = undefined;
    if (!this.live) return;
    const due = this.rows
      .filter((row) => row.status === "enabled" && row.nextRunAt !== null)
      .map((row) => Date.parse(row.nextRunAt!))
      .filter((time) => Number.isFinite(time));
    if (due.length === 0) return;
    const delay = Math.max(0, Math.min(...due) - this.now()) + this.afterDueMs;
    this.dueTimer = setTimeout(
      () => {
        this.dueTimer = undefined;
        this.schedule(0);
      },
      Math.min(delay, MAX_TIMER_MS),
    );
  }

  // ---- view ---------------------------------------------------------------

  private derive(): AutomationSnapshot {
    let automations = orderAutomations(this.rows);
    const pending = this.pendingOrder;
    if (pending) {
      const byId = new Map(automations.map((row) => [row.id as string, row]));
      automations = [
        ...pending.ids.flatMap((id) => {
          const row = byId.get(id);
          return row ? [row] : [];
        }),
        ...automations.filter((row) => !pending.ids.includes(row.id)),
      ];
    }
    return {
      automations,
      status: this.loaded ? "ready" : "loading",
      error: this.error,
    };
  }

  // ---- writes -------------------------------------------------------------

  /**
   * A write's answer. The task count is not part of it: it stays as it was,
   * and a new automation has created none.
   */
  private merge(automation: TaskAutomation) {
    const previous = this.rows.find((row) => row.id === automation.id);
    const taskCount = previous ? previous.taskCount : 0;
    const merged: TaskAutomationListItem = {
      ...automation,
      ...(taskCount !== undefined ? { taskCount } : {}),
    };
    this.rows = previous
      ? this.rows.map((row) => (row.id === automation.id ? merged : row))
      : [merged, ...this.rows];
    this.writes += 1;
    this.armDue();
  }

  private async write<T>(
    title: string,
    run: () => Promise<T>,
    merge: (result: T) => void,
  ): Promise<T | null> {
    try {
      const result = await run();
      merge(result);
      return result;
    } catch (error) {
      this.onError(title, error);
      return null;
    } finally {
      this.emit();
    }
  }

  /** Creates or saves an automation; resolves to the saved one, or null on failure. */
  upsert(input: TaskAutomationUpsertInput): Promise<TaskAutomation | null> {
    return this.write(
      input.id ? "Could not save the automation" : "Could not create the automation",
      () => this.client.automations.upsert(input),
      (automation) => this.merge(automation),
    );
  }

  async setStatus(id: string, status: TaskAutomationStatus): Promise<boolean> {
    const saved = await this.write(
      status === "enabled" ? "Could not enable the automation" : "Could not pause the automation",
      () => this.client.automations.setStatus({ id: id as TaskAutomationId, status }),
      (automation) => this.merge(automation),
    );
    return saved !== null;
  }

  async remove(id: string): Promise<boolean> {
    const done = await this.write(
      "Could not delete the automation",
      () => this.client.automations.delete({ id: id as TaskAutomationId }).then(() => true),
      () => {
        this.rows = this.rows.filter((row) => row.id !== id);
        this.writes += 1;
        this.armDue();
      },
    );
    return done !== null;
  }

  async reorder(id: string, anchor: AutomationAnchor): Promise<boolean> {
    const op = this.nextOp++;
    const ids = moveAutomationId(
      this.getSnapshot().automations.map((row) => row.id),
      id,
      anchor,
    );
    this.pendingOrder = { op, ids };
    this.emit();
    const saved = await this.write(
      "Could not move the automation",
      () =>
        this.client.automations.reorder({
          id: id as TaskAutomationId,
          ...(anchor.beforeAutomationId
            ? { beforeAutomationId: anchor.beforeAutomationId as TaskAutomationId }
            : {}),
          ...(anchor.afterAutomationId
            ? { afterAutomationId: anchor.afterAutomationId as TaskAutomationId }
            : {}),
        }),
      (automation) => this.merge(automation),
    );
    if (this.pendingOrder?.op === op) this.pendingOrder = null;
    this.emit();
    // A move that ran out of room renumbers every automation on the server.
    if (saved !== null && this.live) this.schedule(0);
    return saved !== null;
  }
}
