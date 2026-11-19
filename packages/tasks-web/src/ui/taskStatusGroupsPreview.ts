import { useSyncExternalStore } from "react";
import type { TaskCreateInput } from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";

/**
 * Design-only helper for the status groups, used from the dev console and the
 * capture script: adds sample tasks through the view's own client and gives
 * tasks stand-in run counts by title prefix (a design home has no real runs).
 * Remove this file when the groups are built.
 */
type StandInRuns = Readonly<
  Record<
    string,
    {
      readonly runCounts: ReadonlyArray<{ readonly status: string; readonly count: number }>;
      readonly latestRunStatus: string;
    }
  >
>;

let runs: StandInRuns = {};
let designClient: TasksWebRpcClient | null = null;
const listeners = new Set<() => void>();

export function useStandInRuns(): StandInRuns {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => runs,
    () => runs,
  );
}

/** The Tasks view hands over a client, so the console can add sample tasks. */
export function setTaskStatusGroupsDesignClient(client: TasksWebRpcClient | null) {
  if (client) designClient = client;
}

const preview = {
  create: async (input: TaskCreateInput) => {
    if (!designClient) throw new Error("No computer with Tasks is connected.");
    return designClient.tasks.create(input);
  },
  runs: (next: StandInRuns) => {
    runs = next;
    for (const listener of listeners) listener();
  },
  ready: () => designClient !== null,
};

if (import.meta.env.DEV) {
  (window as unknown as { taskStatusGroupsPreview: typeof preview }).taskStatusGroupsPreview =
    preview;
}
