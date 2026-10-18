import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import {
  type EnvironmentCatalogState,
  enabledEnvironmentIds,
} from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { serverEnvironment } from "./server";
import { environmentShell, expectsPrimaryEnvironment, hasPrimaryEnvironment } from "./shell";

/**
 * UpComputer: how long the first load may hold back the workspace. After it,
 * the sidebar and home show what they know and a late environment fills in
 * when it connects; a loading state that never ends is worse than a late row.
 */
const WORKSPACE_FIRST_LOAD_DEADLINE_MS = 6_000;

/** An environment that will not deliver data soon; waiting for it would hang. */
function connectionSettledWithoutData(
  connection: SupervisorConnectionState,
  isPrimary: boolean,
): boolean {
  switch (connection.phase) {
    case "offline":
    case "blocked":
      return true;
    case "backoff":
      return connection.attempt > 2;
    // Also the value before the supervisor first reports, so the primary,
    // which always connects, keeps waiting through it.
    case "available":
      return !isPrimary && !connection.desired;
    default:
      return false;
  }
}

interface WorkspaceReadinessInput {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<SupervisorConnectionState | null>;
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<unknown>;
  readonly expectsPrimaryEnvironment: () => boolean;
  /** Turns true once the first load has waited long enough. */
  readonly deadlinePassedAtom: Atom.Atom<boolean>;
}

/**
 * UpComputer: whether the client knows what each environment holds, so home
 * and the sidebar can tell "not loaded yet" from "nothing there". Until an
 * environment's server config arrives its scratch project ("No project") reads
 * as an ordinary project. With `requireLive`, a cached shell does not count
 * either: it can be stale or partial. An environment that settled offline
 * counts as known, with what its cache holds.
 *
 * These are first-load gates. Each environment counts on its own, so one that
 * is slow or failing never holds back another's rows, and once it counted it
 * stays counted: a reconnect or a stream error later never hides what the
 * user already saw. The deadline ends the first load for every environment.
 */
function createWorkspaceReadinessAtoms(input: WorkspaceReadinessInput, requireLive: boolean) {
  const label = requireLive ? "web-workspace-settled" : "web-workspace-known";
  const counted = new Set<EnvironmentId>();
  let countedSnapshot: ReadonlySet<EnvironmentId> = new Set();

  const environmentIdsAtom = Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    const deadlinePassed = get(input.deadlinePassedAtom);
    const environmentReady = (environmentId: EnvironmentId): boolean => {
      const shell = get(input.shellStateValueAtom(environmentId));
      if (
        (shell.status === "live" || !requireLive) &&
        Option.isSome(shell.snapshot) &&
        get(input.serverConfigValueAtom(environmentId)) !== null
      ) {
        return true;
      }
      const connection = get(input.connectionStateAtom(environmentId));
      const isPrimary =
        catalog.entries.get(environmentId)?.target._tag === "PrimaryConnectionTarget";
      return connection !== null && connectionSettledWithoutData(connection, isPrimary);
    };
    let changed = false;
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      if (counted.has(environmentId)) continue;
      if (deadlinePassed || environmentReady(environmentId)) {
        counted.add(environmentId);
        changed = true;
      }
    }
    if (changed) countedSnapshot = new Set(counted);
    return countedSnapshot;
  }).pipe(Atom.keepAlive, Atom.withLabel(`${label}-environments`));

  const workspaceAtom = Atom.make((get) => {
    if (Option.getOrUndefined(get.self<boolean>()) === true) return true;
    if (get(input.deadlinePassedAtom)) return true;
    const catalog = get(input.catalogValueAtom);
    if (!catalog.isReady) return false;
    // The persisted catalog can emit before the primary environment registers.
    if (input.expectsPrimaryEnvironment() && !hasPrimaryEnvironment(catalog)) return false;
    const environmentIds = get(environmentIdsAtom);
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      if (!environmentIds.has(environmentId)) return false;
    }
    return true;
  }).pipe(Atom.keepAlive, Atom.withLabel(label));

  return { environmentIdsAtom, workspaceAtom };
}

export interface WaitingWorkspaceEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
  /** Its connection stopped trying for now, so it is not just slow. */
  readonly unreachable: boolean;
}

export interface WorkspaceDelivery {
  /** Every environment the user connects to sent its live data at least once. */
  readonly delivered: boolean;
  readonly waitingOn: ReadonlyArray<WaitingWorkspaceEnvironment>;
}

const WORKSPACE_NOT_DELIVERED: WorkspaceDelivery = { delivered: false, waitingOn: [] };
const WORKSPACE_DELIVERED: WorkspaceDelivery = { delivered: true, waitingOn: [] };

/**
 * UpComputer: proof for an empty claim. The readiness gates may reveal what is
 * known once the deadline passes; "No threads yet" and the "Add a project"
 * hero need every environment to have sent its live data, as a cache or a
 * missing connection proves nothing. An environment the user does not connect
 * to is left out, since it will not send anything.
 */
function createWorkspaceDeliveryAtom(input: WorkspaceReadinessInput) {
  const delivered = new Set<EnvironmentId>();
  let previous = WORKSPACE_NOT_DELIVERED;
  let previousKey = "";
  return Atom.make((get): WorkspaceDelivery => {
    const catalog = get(input.catalogValueAtom);
    if (!catalog.isReady) return WORKSPACE_NOT_DELIVERED;
    if (input.expectsPrimaryEnvironment() && !hasPrimaryEnvironment(catalog)) {
      return WORKSPACE_NOT_DELIVERED;
    }
    const waitingOn: WaitingWorkspaceEnvironment[] = [];
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      if (delivered.has(environmentId)) continue;
      const shell = get(input.shellStateValueAtom(environmentId));
      if (
        shell.status === "live" &&
        Option.isSome(shell.snapshot) &&
        get(input.serverConfigValueAtom(environmentId)) !== null
      ) {
        delivered.add(environmentId);
        continue;
      }
      const target = catalog.entries.get(environmentId)?.target;
      const isPrimary = target?._tag === "PrimaryConnectionTarget";
      const connection = get(input.connectionStateAtom(environmentId));
      if (!isPrimary && connection?.phase === "available" && !connection.desired) continue;
      waitingOn.push({
        environmentId,
        label: target?.label ?? environmentId,
        isPrimary,
        unreachable: connection !== null && connectionSettledWithoutData(connection, isPrimary),
      });
    }
    if (waitingOn.length === 0) return WORKSPACE_DELIVERED;
    // Shell updates recompute this; keep the value stable so readers only
    // render when what they show changes.
    const key = waitingOn
      .map(
        (environment) =>
          `${environment.environmentId}:${environment.label}:${environment.unreachable}`,
      )
      .join("\0");
    if (key !== previousKey) {
      previousKey = key;
      previous = { delivered: false, waitingOn };
    }
    return previous;
  }).pipe(Atom.keepAlive, Atom.withLabel("web-workspace-delivery"));
}

export function createWorkspaceAtoms(input: WorkspaceReadinessInput) {
  const known = createWorkspaceReadinessAtoms(input, false);
  const settled = createWorkspaceReadinessAtoms(input, true);
  return {
    workspaceKnownAtom: known.workspaceAtom,
    workspaceSettledAtom: settled.workspaceAtom,
    settledEnvironmentIdsAtom: settled.environmentIdsAtom,
    workspaceDeliveryAtom: createWorkspaceDeliveryAtom(input),
  };
}

const connectionStateValueAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    Option.getOrNull(AsyncResult.value(get(environmentCatalog.stateAtom(environmentId)))),
  ).pipe(Atom.withLabel(`web-connection-state-value:${environmentId}`)),
);

const firstLoadDeadlinePassedAtom = Atom.make((get) => {
  const timer = setTimeout(() => get.setSelf(true), WORKSPACE_FIRST_LOAD_DEADLINE_MS);
  get.addFinalizer(() => clearTimeout(timer));
  return false;
}).pipe(Atom.keepAlive, Atom.withLabel("web-workspace-first-load-deadline"));

export const {
  /** Known from cached shells; enough to pick home's draft without waiting for the server. */
  workspaceKnownAtom,
  /** Known from live shells, or the first load gave up waiting; what may be revealed. */
  workspaceSettledAtom,
  /** Environments whose thread rows the sidebar may show. */
  settledEnvironmentIdsAtom,
  /** Whether an empty state may claim the workspace is empty. */
  workspaceDeliveryAtom,
} = createWorkspaceAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
  connectionStateAtom: connectionStateValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
  expectsPrimaryEnvironment,
  deadlinePassedAtom: firstLoadDeadlinePassedAtom,
});
