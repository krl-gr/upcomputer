import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import type { TasksWebAvailability } from "../../rpc/capabilityGate.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";

/**
 * UpComputer: how long the planner and automations say they are loading
 * while Tasks access is probed. A disconnected environment keeps its probe
 * loading as it retries, so past this the views say it is not reachable.
 */
const TASKS_INITIAL_WAIT_MS = 5_000;

/** Whether an environment's Tasks access is still being probed. */
export function tasksAccessPending(targets: readonly TasksStateTarget[]): boolean {
  return targets.some((target) => target.access.availability === "loading");
}

/**
 * UpComputer: what a Tasks view shows before its environment's answer.
 * - `none`: no environment serves Tasks;
 * - `loading`: a probe is running and the initial wait has not passed;
 * - `offline`: a probe is still retrying after the initial wait;
 * - `answered`: the chosen environment answered, enabled or unavailable.
 */
export function resolveTasksViewGate(input: {
  readonly environmentId: EnvironmentId | null;
  readonly availability: TasksWebAvailability | null;
  readonly accessPending: boolean;
  readonly initialWaitOver: boolean;
}): "none" | "loading" | "offline" | "answered" {
  if (input.environmentId === null && !input.accessPending) return "none";
  if (input.environmentId !== null && input.availability !== null) {
    if (input.availability !== "loading") return "answered";
  }
  return input.initialWaitOver ? "offline" : "loading";
}

/**
 * UpComputer: the Agents page's status from its environments' loads. An
 * environment whose Tasks access is still probed loads until the initial wait
 * passes, then counts as offline; neither is shown as an error.
 */
export function resolveEnvironmentsViewStatus(input: {
  readonly loading: boolean;
  readonly states: ReadonlyArray<{
    readonly status: "loading" | "ready" | "unavailable" | "error";
    readonly message?: string;
  }>;
  readonly initialWaitOver: boolean;
}): { readonly status: "loading" | "ready" | "error" | "offline"; readonly message?: string } {
  if (input.loading) return { status: "loading" };
  const { states } = input;
  if (states.length === 0 || states.some((state) => state.status === "ready")) {
    return { status: "ready" };
  }
  if (states.some((state) => state.status === "loading")) {
    return { status: input.initialWaitOver ? "offline" : "loading" };
  }
  const failure = states.find(
    (state) => state.status === "error" || state.status === "unavailable",
  );
  return failure?.message ? { status: "error", message: failure.message } : { status: "ready" };
}

let initialWaitEndsAt: number | null = null;

/** Whether the session's first Tasks view has waited `TASKS_INITIAL_WAIT_MS`. */
export function useTasksInitialWaitOver(): boolean {
  const [over, setOver] = useState(() => {
    initialWaitEndsAt ??= Date.now() + TASKS_INITIAL_WAIT_MS;
    return Date.now() >= initialWaitEndsAt;
  });
  useEffect(() => {
    if (over || initialWaitEndsAt === null) return;
    const timer = setTimeout(() => setOver(true), Math.max(0, initialWaitEndsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [over]);
  return over;
}
