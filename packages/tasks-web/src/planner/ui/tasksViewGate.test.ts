import * as NodeAssert from "node:assert/strict";
import type { EnvironmentId } from "@t3tools/contracts";
import { test } from "vite-plus/test";

import { resolveTasksWebAccess, type TasksWebAvailability } from "../../rpc/capabilityGate.ts";
import type { TasksWebRpcClient } from "../../rpc/index.ts";
import { loadAgentsState } from "../../state/agentsState.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";
import {
  resolveEnvironmentsViewStatus,
  resolveTaskPagesStatus,
  resolveTasksViewGate,
  tasksAccessPending,
} from "./tasksViewGate.ts";

const LOCAL = "local" as EnvironmentId;

const target = (availability: TasksWebAvailability, canReadTasks: boolean) =>
  ({
    environmentId: LOCAL,
    access: { availability, canReadTasks },
  }) as unknown as TasksStateTarget;

test("Tasks waits for its access probe before saying no environment serves it", () => {
  // Opened right after launch, the planner said "No connected environment
  // serves Tasks." while the probe ran, then showed the real page.
  NodeAssert.equal(tasksAccessPending([target("loading", false)]), true);
  NodeAssert.equal(tasksAccessPending([target("unavailable", false)]), false);
  NodeAssert.equal(tasksAccessPending([target("enabled", true), target("loading", false)]), true);
  NodeAssert.equal(tasksAccessPending([]), false);
});

test("a disconnected Tasks environment stops loading after the initial wait", () => {
  // Astra review G: a saved environment that is offline keeps its probe
  // loading as it retries every two seconds, so the planner loaded forever.
  const gate = (
    environmentId: EnvironmentId | null,
    availability: TasksWebAvailability | null,
    initialWaitOver: boolean,
  ) =>
    resolveTasksViewGate({
      environmentId,
      availability,
      accessPending: tasksAccessPending([target("loading", false)]),
      initialWaitOver,
    });
  for (let retry = 0; retry < 4; retry += 1) {
    NodeAssert.equal(gate(null, null, false), "loading");
  }
  NodeAssert.equal(gate(null, null, true), "offline");
  // The chosen environment's planner probe retrying the same way.
  NodeAssert.equal(gate(LOCAL, "loading", false), "loading");
  NodeAssert.equal(gate(LOCAL, "loading", true), "offline");
  NodeAssert.equal(gate(LOCAL, "enabled", true), "answered");
  NodeAssert.equal(gate(LOCAL, "unavailable", false), "answered");
});

test("no environment serving Tasks is said at once", () => {
  NodeAssert.equal(
    resolveTasksViewGate({
      environmentId: null,
      availability: null,
      accessPending: false,
      initialWaitOver: false,
    }),
    "none",
  );
});

test("Agents loads while Tasks access is probed instead of showing the probe as an error", async () => {
  // LT23: the first Agents visit after launch showed "Checking whether the
  // server has Tasks." in a red banner for up to 0.71 s.
  const search = () => Promise.reject(new Error("not called"));
  const client = { agents: { search, searchRuns: search } } as unknown as TasksWebRpcClient;
  const probing = await loadAgentsState([
    { environmentId: LOCAL, client, access: resolveTasksWebAccess({ availability: "loading" }) },
  ]);
  const states = Object.values(probing.byEnvironment);
  NodeAssert.deepEqual(
    states.map((state) => state.status),
    ["loading"],
  );
  NodeAssert.deepEqual(
    resolveEnvironmentsViewStatus({ loading: false, states, initialWaitOver: false }),
    { status: "loading" },
  );
  // A probe that keeps retrying ends in the neutral offline notice.
  NodeAssert.deepEqual(
    resolveEnvironmentsViewStatus({ loading: false, states, initialWaitOver: true }),
    { status: "offline" },
  );

  const unavailable = await loadAgentsState([
    {
      environmentId: LOCAL,
      client,
      access: resolveTasksWebAccess({ availability: "unavailable" }),
    },
  ]);
  NodeAssert.deepEqual(
    resolveEnvironmentsViewStatus({
      loading: false,
      states: Object.values(unavailable.byEnvironment),
      initialWaitOver: false,
    }),
    { status: "error", message: "The connected server does not serve Tasks." },
  );
});

test("an environment that answered shows its agents while another is still probed", () => {
  NodeAssert.deepEqual(
    resolveEnvironmentsViewStatus({
      loading: false,
      states: [{ status: "loading" }, { status: "ready" }],
      initialWaitOver: false,
    }),
    { status: "ready" },
  );
  NodeAssert.deepEqual(
    resolveEnvironmentsViewStatus({ loading: true, states: [], initialWaitOver: true }),
    { status: "loading" },
  );
});

test("a disconnected computer does not turn the Tasks list into an error", () => {
  // The user's sleeping PC put "Up.computer couldn't load your tasks. DESKTOP is
  // not connected. Retry" over the Mac's tasks, and Retry could not clear it.
  const PC = "pc" as EnvironmentId;
  const lane = (
    environmentId: EnvironmentId,
    state: { initialLoading?: boolean; error?: string; disconnected?: boolean } | undefined,
    accessPending = false,
  ) => ({
    environmentId,
    accessPending,
    state: state && {
      initialLoading: state.initialLoading ?? false,
      error: state.error,
      disconnected: state.disconnected ?? false,
    },
  });
  const notConnected = { error: "PC is not connected.", disconnected: true };
  const resolve = (lanes: ReturnType<typeof lane>[], initialWaitOver = false) =>
    resolveTaskPagesStatus({ lanes, initialWaitOver });

  NodeAssert.deepEqual(resolve([lane(LOCAL, {}), lane(PC, notConnected)]), {
    status: "ready",
    errorMessage: "",
    offlineEnvironmentIds: [PC],
  });
  NodeAssert.deepEqual(resolve([lane(LOCAL, notConnected), lane(PC, notConnected)]), {
    status: "offline",
    errorMessage: "",
    offlineEnvironmentIds: [LOCAL, PC],
  });
  NodeAssert.deepEqual(
    resolve([lane(LOCAL, { error: "Database is locked." }), lane(PC, notConnected)]),
    { status: "error", errorMessage: "Database is locked.", offlineEnvironmentIds: [PC] },
  );
  // The other computer's first page still decides; then its tasks show beside the note.
  NodeAssert.equal(
    resolve([lane(LOCAL, { initialLoading: true }), lane(PC, notConnected)]).status,
    "loading",
  );
  // A computer whose access probe still retries waits, then is offline like a disconnected one.
  const probing = lane(PC, { initialLoading: true }, true);
  NodeAssert.equal(resolve([lane(LOCAL, {}), probing]).status, "loading");
  NodeAssert.deepEqual(resolve([lane(LOCAL, {}), probing], true), {
    status: "ready",
    errorMessage: "",
    offlineEnvironmentIds: [PC],
  });
  NodeAssert.equal(resolve([probing], true).status, "offline");
  NodeAssert.equal(resolve([]).status, "ready");
});
