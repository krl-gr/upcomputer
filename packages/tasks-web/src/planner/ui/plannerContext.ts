import { createContext, use } from "react";

import type { PlannerAudience, PlannerKind, PlannerPreferences } from "../data/preferences.ts";
import type { PlannerStore } from "../data/plannerStore.ts";
import type { WindowStore } from "../windows/windowStore.ts";
import type { PlannerProject } from "./ProjectChip.tsx";

/**
 * What every planner component reads and that changes rarely: the stores,
 * the environment's projects and the preferences. Data that changes with
 * every write travels as props, so memoized rows skip unrelated updates.
 */
export interface PlannerContextValue {
  readonly environmentId: string;
  readonly store: PlannerStore;
  readonly windows: WindowStore;
  readonly projects: readonly PlannerProject[];
  readonly projectById: ReadonlyMap<string, PlannerProject>;
  readonly preferences: PlannerPreferences;
  /** A project directory for markdown links in descriptions. */
  readonly markdownCwd: string | undefined;
  /** Whose tasks the lists show (Mine / Agents / All). */
  readonly audience: PlannerAudience;
  /** Whether the list shows tasks or routines. */
  readonly kind: PlannerKind;
  /** Tags an enabled agent of this environment starts on. */
  readonly triggerTags: ReadonlySet<string>;
  /** Opens a task in the table, which shows its agent runs. */
  readonly openInTable: (taskId: string) => void;
}

export const PlannerContext = createContext<PlannerContextValue | null>(null);

export function usePlanner(): PlannerContextValue {
  const value = use(PlannerContext);
  if (!value) throw new Error("usePlanner must be used inside the planner.");
  return value;
}
