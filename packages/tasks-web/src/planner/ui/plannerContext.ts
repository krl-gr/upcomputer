import { createContext, use } from "react";

import type { PlannerKind, PlannerPreferences } from "../data/preferences.ts";
import type { AutomationStore } from "../data/automationStore.ts";
import type { PlannerStore } from "../data/plannerStore.ts";
import type { WindowStore } from "../windows/windowStore.ts";
import type { PlannerProject } from "./ProjectChip.tsx";

/**
 * What every planner component reads and that changes rarely: the stores,
 * the environment's projects and the preferences. Data that changes with
 * every write travels as props, so memoized rows skip unrelated updates.
 * The table's Automations section provides it too, for automation and task
 * windows.
 */
export interface PlannerContextValue {
  readonly environmentId: string;
  readonly store: PlannerStore;
  /** The environment's automations: the agents' routines. */
  readonly automations: AutomationStore;
  readonly windows: WindowStore;
  readonly projects: readonly PlannerProject[];
  readonly projectById: ReadonlyMap<string, PlannerProject>;
  readonly preferences: PlannerPreferences;
  /** Whether the list shows tasks or routines. */
  readonly kind: PlannerKind;
  /** Tags an enabled agent of this environment starts on. */
  readonly triggerTags: ReadonlySet<string>;
  /** Opens a task in the table, which shows its agent runs. */
  readonly openInTable: (taskId: string) => void;
  /** Opens a task's window in the planner, switching to it from the table. */
  readonly openInPlanner: (taskId: string) => void;
}

export const PlannerContext = createContext<PlannerContextValue | null>(null);

export function usePlanner(): PlannerContextValue {
  const value = use(PlannerContext);
  if (!value) throw new Error("usePlanner must be used inside the planner.");
  return value;
}
