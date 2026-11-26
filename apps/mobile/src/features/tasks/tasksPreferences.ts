import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { DEFAULT_WORKER_TASK_FILTERS, WorkerTaskFilters } from "./taskListState";

/** The Tasks tab's views, as the desktop names them. */
export const TasksView = Schema.Literals(["workers", "automations", "mine", "routines"]);
export type TasksView = typeof TasksView.Type;

/** The desktop's "Days shown" choices for the planner's week. */
export const PLANNER_DAYS_SHOWN = [1, 2, 3, 7] as const;
const PlannerDaysShown = Schema.Literals(PLANNER_DAYS_SHOWN);
export type PlannerDaysShown = typeof PlannerDaysShown.Type;

/**
 * What the Tasks tab remembers on this phone: the view, the computer, the Worker tasks filters
 * (as the desktop keeps its own) and the planner's week.
 */
const TasksPreferences = Schema.Struct({
  view: TasksView,
  environmentId: Schema.NullOr(Schema.String),
  workerFilters: WorkerTaskFilters,
  /** Two on the phone, where the desktop's seven are unreadable. */
  daysShown: PlannerDaysShown,
  weekHidden: Schema.Boolean,
  /** The week's height after the handle moved it; null for the default. */
  weekHeight: Schema.NullOr(Schema.Number),
});
export type TasksPreferences = typeof TasksPreferences.Type;

export const DEFAULT_TASKS_PREFERENCES: TasksPreferences = {
  view: "workers",
  environmentId: null,
  workerFilters: DEFAULT_WORKER_TASK_FILTERS,
  daysShown: 2,
  weekHidden: false,
  weekHeight: null,
};

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/**
 * The stored preferences, with the defaults for anything missing or unreadable, field by field,
 * so a new field or a bad value never resets the rest.
 */
export function decodeTasksPreferences(raw: string | null): TasksPreferences {
  if (!raw) return DEFAULT_TASKS_PREFERENCES;
  let stored: unknown;
  try {
    stored = decode(raw);
  } catch {
    return DEFAULT_TASKS_PREFERENCES;
  }
  if (typeof stored !== "object" || stored === null) return DEFAULT_TASKS_PREFERENCES;
  const result: Record<string, unknown> = { ...DEFAULT_TASKS_PREFERENCES };
  const fields: Record<string, Schema.Top> = TasksPreferences.fields;
  for (const [key, value] of Object.entries(stored)) {
    const field = fields[key];
    if (field === undefined) continue;
    const decoded = Schema.decodeUnknownOption(field as Schema.Codec<unknown>)(value);
    if (decoded._tag === "Some") result[key] = decoded.value;
  }
  return result as TasksPreferences;
}

const STORAGE_KEY = "upcomputer.tasks-tab.v1";
const listeners = new Set<() => void>();
let current: TasksPreferences | null = null;

function read(): TasksPreferences {
  if (current === null) {
    try {
      current = decodeTasksPreferences(SecureStore.getItem(STORAGE_KEY));
    } catch {
      current = DEFAULT_TASKS_PREFERENCES;
    }
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateTasksPreferences(patch: Partial<TasksPreferences>) {
  current = { ...read(), ...patch };
  for (const listener of listeners) listener();
  void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(current)).catch(() => undefined);
}

export function useTasksPreferences(): TasksPreferences {
  return useSyncExternalStore(subscribe, read, read);
}
