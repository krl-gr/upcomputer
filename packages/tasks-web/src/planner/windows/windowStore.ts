/**
 * The planner's floating windows, kept per environment at module level so
 * they are still open after leaving /tasks and coming back (wande keeps them
 * across tabs). One detail window per task and per automation, any number of
 * create windows; a focused window comes to the front.
 */
import { useSyncExternalStore } from "react";

export interface WindowPosition {
  readonly x: number;
  readonly y: number;
}

/** Where a create window puts the new task, its preset project, and whether it is a routine. */
export interface CreateWindowInitial {
  readonly kind?: "routine";
  readonly projectId?: string;
  readonly beforeTaskId?: string;
  readonly afterTaskId?: string;
}

export type PlannerWindow =
  | {
      readonly kind: "create";
      readonly id: string;
      readonly z: number;
      readonly position?: WindowPosition;
      readonly initial: CreateWindowInitial;
    }
  | {
      readonly kind: "detail";
      readonly id: string;
      readonly taskId: string;
      readonly z: number;
      readonly position?: WindowPosition;
      readonly viewMode: "description" | "instances";
    }
  | {
      /** An automation's settings and tasks; a new automation while `automationId` is null. */
      readonly kind: "automation";
      readonly id: string;
      readonly automationId: string | null;
      readonly z: number;
      readonly position?: WindowPosition;
    };

/** Above the page and its sheets, below menus and popovers (z-[130]). */
const BASE_Z = 60;

export class WindowStore {
  private windows: readonly PlannerWindow[] = [];
  private nextZ = BASE_Z;
  private nextCreate = 1;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.windows;

  private set(windows: readonly PlannerWindow[]) {
    this.windows = windows;
    for (const listener of this.listeners) listener();
  }

  private bump() {
    this.nextZ += 1;
    return this.nextZ;
  }

  openCreate(initial: CreateWindowInitial = {}): string {
    const id = `create-${this.nextCreate++}`;
    this.set([...this.windows, { kind: "create", id, z: this.bump(), initial }]);
    return id;
  }

  /** Opens a window for a new automation. */
  openCreateAutomation(): string {
    const id = `create-automation-${this.nextCreate++}`;
    this.set([...this.windows, { kind: "automation", id, automationId: null, z: this.bump() }]);
    return id;
  }

  /** Opens an automation's window, or raises it; `replacing` turns a create window into it. */
  openAutomation(automationId: string, replacing?: string) {
    const z = this.bump();
    const id = `automation-${automationId}`;
    const existing = this.windows.find((window) => window.id === id);
    const replaced = replacing ? this.windows.find((window) => window.id === replacing) : undefined;
    const others = this.windows.filter((window) => window.id !== id && window.id !== replacing);
    this.set([
      ...others,
      {
        kind: "automation",
        id,
        automationId,
        z,
        ...((existing ?? replaced)?.position
          ? { position: (existing ?? replaced)!.position! }
          : {}),
      },
    ]);
  }

  /** Opens a task's window, or raises it (switching the view when asked). */
  openDetail(taskId: string, viewMode?: "description" | "instances") {
    const z = this.bump();
    const existing = this.windows.find(
      (window) => window.kind === "detail" && window.taskId === taskId,
    );
    if (existing)
      this.set(
        this.windows.map((window) =>
          window === existing && window.kind === "detail"
            ? { ...window, z, ...(viewMode ? { viewMode } : {}) }
            : window,
        ),
      );
    else
      this.set([
        ...this.windows,
        { kind: "detail", id: `detail-${taskId}`, taskId, z, viewMode: viewMode ?? "description" },
      ]);
  }

  focus(id: string) {
    const top = this.windows.reduce((max, window) => Math.max(max, window.z), 0);
    const window = this.windows.find((candidate) => candidate.id === id);
    if (!window || window.z === top) return;
    const z = this.bump();
    this.set(
      this.windows.map((candidate) => (candidate.id === id ? { ...candidate, z } : candidate)),
    );
  }

  move(id: string, position: WindowPosition) {
    this.set(this.windows.map((window) => (window.id === id ? { ...window, position } : window)));
  }

  setViewMode(id: string, viewMode: "description" | "instances") {
    this.set(
      this.windows.map((window) =>
        window.id === id && window.kind === "detail" ? { ...window, viewMode } : window,
      ),
    );
  }

  close(id: string) {
    this.set(this.windows.filter((window) => window.id !== id));
  }
}

const stores = new Map<string, WindowStore>();

export function windowStoreFor(environmentId: string): WindowStore {
  let store = stores.get(environmentId);
  if (!store) {
    store = new WindowStore();
    stores.set(environmentId, store);
  }
  return store;
}

export function usePlannerWindows(store: WindowStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
