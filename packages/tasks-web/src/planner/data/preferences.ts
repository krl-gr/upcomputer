/**
 * Planner preferences and view state, per device in local storage (wande
 * synced the preferences; moving them to the server waits for a multi-device
 * need). Every field is optional on disk, so values saved by an older build
 * still decode and missing ones take the defaults.
 */
import * as Schema from "effect/Schema";
import { useCallback, useMemo } from "react";

import {
  setLocalStorageItem,
  useLocalStorage,
} from "../../../../../apps/web/src/hooks/useLocalStorage.ts";
import { DAY_COUNT_OPTIONS, todayKey } from "../logic/dates.ts";
import { MIN_LIST_WIDTH } from "../logic/plannerWidth.ts";

const PlannerPreferencesSchema = Schema.Struct({
  weekViewMode: Schema.optional(Schema.Literals(["queue", "calendar"])),
  /** 0 is Sunday. */
  weekStartDay: Schema.optional(Schema.Int),
  defaultTaskDuration: Schema.optional(Schema.Int),
  defaultRoutineDuration: Schema.optional(Schema.Int),
  cardStyle: Schema.optional(Schema.Literals(["classic", "modern"])),
  showProgress: Schema.optional(Schema.Boolean),
  /** Pixels per quarter hour in the calendar, 5 to 30. */
  slotHeight: Schema.optional(Schema.Int),
});

const PlannerViewStateSchema = Schema.Struct({
  startDate: Schema.optional(Schema.String),
  dayCount: Schema.optional(Schema.Literals(DAY_COUNT_OPTIONS)),
  listWidth: Schema.optional(Schema.Number),
  rightPaneHidden: Schema.optional(Schema.Boolean),
});

export interface PlannerPreferences {
  readonly weekViewMode: "queue" | "calendar";
  readonly weekStartDay: number;
  readonly defaultTaskDuration: number;
  readonly defaultRoutineDuration: number;
  readonly cardStyle: "classic" | "modern";
  readonly showProgress: boolean;
  readonly slotHeight: number;
}

export interface PlannerViewState {
  readonly startDate: string;
  readonly dayCount: (typeof DAY_COUNT_OPTIONS)[number];
  readonly listWidth: number;
  readonly rightPaneHidden: boolean;
}

/** The locale's first day of the week where the browser knows it, else Monday. */
function localeWeekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
    return firstDay === undefined ? 1 : firstDay % 7;
  } catch {
    return 1;
  }
}

export const DEFAULT_LIST_WIDTH = 464;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const PLANNER_PREFERENCES_KEY = "tasks.planner.preferences";
export const PLANNER_VIEW_KEY = "tasks.planner.view";
export const PLANNER_ENVIRONMENT_KEY = "tasks.planner.environment";
export const PLANNER_KIND_KEY = "tasks.planner.kind";
export const TASKS_VIEW_KEY = "tasks.view";
export const TABLE_SECTION_KEY = "tasks.table.section";

export function usePlannerPreferences() {
  const [stored, setStored] = useLocalStorage(
    PLANNER_PREFERENCES_KEY,
    {},
    PlannerPreferencesSchema,
  );
  const preferences = useMemo<PlannerPreferences>(
    () => ({
      weekViewMode: stored.weekViewMode ?? "queue",
      weekStartDay: clamp(stored.weekStartDay ?? localeWeekStart(), 0, 6),
      defaultTaskDuration: clamp(stored.defaultTaskDuration ?? 30, 1, 1440),
      defaultRoutineDuration: clamp(stored.defaultRoutineDuration ?? 60, 1, 1440),
      cardStyle: stored.cardStyle ?? "modern",
      showProgress: stored.showProgress ?? true,
      slotHeight: clamp(stored.slotHeight ?? 15, 5, 30),
    }),
    [stored],
  );
  const update = useCallback(
    (patch: Partial<PlannerPreferences>) => setStored((current) => ({ ...current, ...patch })),
    [setStored],
  );
  return [preferences, update] as const;
}

export function usePlannerViewState() {
  const [stored, setStored] = useLocalStorage(PLANNER_VIEW_KEY, {}, PlannerViewStateSchema);
  const view = useMemo<PlannerViewState>(
    () => ({
      startDate:
        stored.startDate && /^\d{4}-\d{2}-\d{2}$/.test(stored.startDate)
          ? stored.startDate
          : todayKey(),
      dayCount: stored.dayCount ?? 7,
      listWidth: Math.max(MIN_LIST_WIDTH, stored.listWidth ?? DEFAULT_LIST_WIDTH),
      rightPaneHidden: stored.rightPaneHidden ?? false,
    }),
    [stored],
  );
  const update = useCallback(
    (patch: Partial<PlannerViewState>) => setStored((current) => ({ ...current, ...patch })),
    [setStored],
  );
  return [view, update] as const;
}

const TasksViewSchema = Schema.Literals(["planner", "table"]);
/**
 * Whose work the Tasks page shows, one axis: Me is the planner (person tasks
 * and routines), Agents is the table (agent tasks and automations).
 */
export type TasksViewMode = typeof TasksViewSchema.Type;

/** The Tasks page's last side, Me (planner) or Agents (table). */
export function useStoredTasksView() {
  return useLocalStorage<TasksViewMode, TasksViewMode>(TASKS_VIEW_KEY, "planner", TasksViewSchema);
}

const PlannerEnvironmentSchema = Schema.NullOr(Schema.String);

/** The environment the planner and the automations show when several serve Tasks. */
export function useStoredPlannerEnvironment() {
  return useLocalStorage(PLANNER_ENVIRONMENT_KEY, null, PlannerEnvironmentSchema);
}

const PlannerKindSchema = Schema.Literals(["task", "routine"]);
/** Which list the planner shows: Tasks or Routines (wande's two tabs). */
export type PlannerKind = typeof PlannerKindSchema.Type;

export function useStoredPlannerKind() {
  return useLocalStorage<PlannerKind, PlannerKind>(PLANNER_KIND_KEY, "task", PlannerKindSchema);
}

const TableSectionSchema = Schema.Literals(["tasks", "automations"]);
/** What the Agents table lists: the agents' tasks or the automations that create them. */
export type TableSection = typeof TableSectionSchema.Type;

export function useStoredTableSection() {
  return useLocalStorage<TableSection, TableSection>(
    TABLE_SECTION_KEY,
    "tasks",
    TableSectionSchema,
  );
}

/** A scroll position kept per device, written at most every 150 ms (wande's behavior). */
export function scrollMemory(key: string) {
  const storageKey = `tasks.planner.scroll.${key}`;
  return {
    read(): number | null {
      try {
        const value = Number(window.localStorage.getItem(storageKey));
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    },
    follow(element: HTMLElement): () => void {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onScroll = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            window.localStorage.setItem(storageKey, String(Math.round(element.scrollTop)));
          } catch {
            // Storage full or blocked: the position is only a convenience.
          }
        }, 150);
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        clearTimeout(timer);
        element.removeEventListener("scroll", onScroll);
      };
    },
  };
}

/**
 * Makes the Tasks page open on the automations (Agents, Automations), in one
 * environment when given: where the former Automations page sends its links.
 */
export function storeAutomationsView(environmentId: string | null) {
  setLocalStorageItem(TASKS_VIEW_KEY, "table", TasksViewSchema);
  setLocalStorageItem(TABLE_SECTION_KEY, "automations", TableSectionSchema);
  if (environmentId)
    setLocalStorageItem(PLANNER_ENVIRONMENT_KEY, environmentId, PlannerEnvironmentSchema);
}
