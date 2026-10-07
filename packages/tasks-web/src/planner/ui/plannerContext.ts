import { createContext, use } from "react";

import type { PlannerPreferences } from "../data/preferences.ts";
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
}

export const PlannerContext = createContext<PlannerContextValue | null>(null);

export function usePlanner(): PlannerContextValue {
  const value = use(PlannerContext);
  if (!value) throw new Error("usePlanner must be used inside the planner.");
  return value;
}
