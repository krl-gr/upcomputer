import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
  type EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentCatalogState,
  enabledEnvironmentIds,
} from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { isHostedStaticApp } from "../hostedPairing";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { serverEnvironment } from "./server";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);

export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    return false;
  }
  // UpComputer: the persisted catalog can emit before the primary environment
  // registers; its projects are unknown then, not absent.
  if (expectsPrimaryEnvironment() && !hasPrimaryEnvironment(catalog.value)) {
    return false;
  }
  for (const environmentId of enabledEnvironmentIds(catalog.value)) {
    if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) {
      continue;
    }
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (connectionProjectionPhase(connection) !== "disconnected") {
      return false;
    }
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
      return false;
    }
  }
  return true;
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));

function expectsPrimaryEnvironment(): boolean {
  return !isHostedStaticApp() && !isLocalEnvironmentDisabled();
}

function hasPrimaryEnvironment(catalog: EnvironmentCatalogState): boolean {
  return Array.from(catalog.entries.values()).some(
    (entry) => entry.target._tag === "PrimaryConnectionTarget",
  );
}

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

/**
 * UpComputer: whether the client knows what every reachable environment holds,
 * so home and the sidebar can tell "not loaded yet" from "nothing there". A
 * cached shell can be stale, the primary environment can register late, and
 * until an environment's server config arrives its scratch project ("No
 * project") reads as an ordinary project. An environment that settled offline
 * does not hold this back.
 */
export function createWorkspaceSettledAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<SupervisorConnectionState | null>;
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<unknown>;
  readonly expectsPrimaryEnvironment: () => boolean;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    if (!catalog.isReady) return false;
    if (input.expectsPrimaryEnvironment() && !hasPrimaryEnvironment(catalog)) return false;
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      const shell = get(input.shellStateValueAtom(environmentId));
      if (
        shell.status === "live" &&
        Option.isSome(shell.snapshot) &&
        get(input.serverConfigValueAtom(environmentId)) !== null
      ) {
        continue;
      }
      const connection = get(input.connectionStateAtom(environmentId));
      const isPrimary =
        catalog.entries.get(environmentId)?.target._tag === "PrimaryConnectionTarget";
      if (connection === null || !connectionSettledWithoutData(connection, isPrimary)) {
        return false;
      }
    }
    return true;
  }).pipe(Atom.withLabel("web-workspace-settled"));
}

const connectionStateValueAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    Option.getOrNull(AsyncResult.value(get(environmentCatalog.stateAtom(environmentId)))),
  ).pipe(Atom.withLabel(`web-connection-state-value:${environmentId}`)),
);

export const workspaceSettledAtom = createWorkspaceSettledAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
  connectionStateAtom: connectionStateValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
  expectsPrimaryEnvironment,
});

/**
 * The persisted catalog can emit before platform discovery registers the primary environment.
 * Neither that gap nor an empty catalog proves a project is absent.
 */
function catalogIsComplete(
  catalog: EnvironmentCatalogState,
  requiresPrimaryEnvironment: boolean,
): boolean {
  if (!catalog.isReady || catalog.entries.size === 0) return false;
  return !requiresPrimaryEnvironment || hasPrimaryEnvironment(catalog);
}

export function createAllEnvironmentProjectSnapshotsReadyAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly requiresPrimaryEnvironment: boolean;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    if (!catalogIsComplete(catalog, input.requiresPrimaryEnvironment)) return false;
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      const shell = get(input.shellStateValueAtom(environmentId));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) return false;
    }
    return true;
  }).pipe(Atom.withLabel("web-all-environment-project-snapshots-ready"));
}

export const allEnvironmentProjectSnapshotsReadyAtom =
  createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    shellStateValueAtom: environmentShell.stateValueAtom,
    requiresPrimaryEnvironment: !isHostedStaticApp(),
  });

export const allReachableShellsLiveAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  if (!catalogIsComplete(catalog, !isHostedStaticApp())) return false;
  for (const environmentId of enabledEnvironmentIds(catalog)) {
    const shell = get(environmentShell.stateValueAtom(environmentId));
    if (shell.status === "live" && Option.isSome(shell.snapshot)) continue;
    const state = AsyncResult.value(get(environmentCatalog.stateAtom(environmentId)));
    if (Option.isNone(state)) return false;
    const connection = state.value;
    const settledOffline =
      connection.phase === "offline" ||
      connection.phase === "blocked" ||
      (connection.phase === "backoff" && connection.attempt > 2);
    if (!settledOffline) return false;
  }
  return true;
}).pipe(Atom.withLabel("web-all-reachable-shells-live"));
