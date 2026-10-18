import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createAllEnvironmentProjectSnapshotsReadyAtom, createWorkspaceSettledAtom } from "./shell";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    status,
    snapshot:
      status === "empty"
        ? Option.none()
        : Option.some({
            schemaVersion: 1,
            snapshotSequence: 1,
            projects: [],
            threads: [],
            archivedThreads: [],
          }),
    error: Option.none(),
  };
}

function catalogState(environmentIds: readonly EnvironmentId[]): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      environmentIds.map((environmentId) => [
        environmentId,
        {
          target:
            environmentId === LOCAL
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: environmentId,
                  httpBaseUrl: `https://${environmentId}.example.test`,
                  wsBaseUrl: `wss://${environmentId}.example.test`,
                })
              : new BearerConnectionTarget({
                  environmentId,
                  connectionId: environmentId,
                  label: environmentId,
                }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

function makeHarness(requiresPrimaryEnvironment = true) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const ready = createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    requiresPrimaryEnvironment,
  });
  const registry = AtomRegistry.make();
  return { catalog, shells, ready, registry };
}

describe("project snapshot readiness", () => {
  it("does not clear a saved scope while the ready catalog is still empty", () => {
    const { catalog, ready, registry } = makeHarness();
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(ready)).toBe(false);
    registry.dispose();
  });

  it("waits for primary discovery even if a persisted remote is already live", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("allows a hosted client to load projects without a primary environment", () => {
    const { catalog, shells, ready, registry } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("waits for live snapshots through offline startup and reconnect", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("synchronizing"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("stops waiting for an environment only when it leaves the catalog", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([LOCAL]));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });
});

function connection(
  phase: SupervisorConnectionState["phase"],
  overrides: Partial<SupervisorConnectionState> = {},
): SupervisorConnectionState {
  return { ...AVAILABLE_CONNECTION_STATE, phase, desired: phase !== "available", ...overrides };
}

function makeSettledHarness(expectsPrimary = true) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const connections = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<SupervisorConnectionState | null>(null),
  );
  const configs = Atom.family((_environmentId: EnvironmentId) => Atom.make<unknown>(null));
  const settled = createWorkspaceSettledAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    connectionStateAtom: connections,
    serverConfigValueAtom: configs,
    expectsPrimaryEnvironment: () => expectsPrimary,
  });
  const registry = AtomRegistry.make();
  return { catalog, shells, connections, configs, settled, registry };
}

describe("workspace settled", () => {
  it("does not treat a catalog with only a disconnected remote as an empty workspace", () => {
    const { catalog, connections, settled, registry } = makeSettledHarness();
    expect(registry.get(settled)).toBe(false);
    // The relaunch that showed the "Add a project" hero: the persisted catalog
    // held only a managed VM that was not connected, the primary not yet registered.
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(connections(REMOTE), connection("offline"));
    expect(registry.get(settled)).toBe(false);
    registry.dispose();
  });

  it("waits for the primary's live shell and server config, not its cache", () => {
    const { catalog, shells, connections, configs, settled, registry } = makeSettledHarness();
    registry.set(catalog, catalogState([LOCAL]));
    registry.set(connections(LOCAL), connection("available", { desired: false }));
    expect(registry.get(settled)).toBe(false);
    registry.set(shells(LOCAL), shellState("cached"));
    registry.set(connections(LOCAL), connection("connecting"));
    expect(registry.get(settled)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(connections(LOCAL), connection("connected"));
    expect(registry.get(settled)).toBe(false);
    registry.set(configs(LOCAL), { scratchWorkspaceRoot: "/scratch" });
    expect(registry.get(settled)).toBe(true);
    registry.dispose();
  });

  it("does not wait for an environment that settled without data", () => {
    const { catalog, shells, connections, configs, settled, registry } = makeSettledHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    registry.set(connections(REMOTE), connection("backoff", { attempt: 1 }));
    expect(registry.get(settled)).toBe(false);
    registry.set(connections(REMOTE), connection("backoff", { attempt: 3 }));
    expect(registry.get(settled)).toBe(true);
    registry.set(connections(REMOTE), connection("available", { desired: false }));
    expect(registry.get(settled)).toBe(true);
    registry.set(connections(REMOTE), connection("connecting"));
    expect(registry.get(settled)).toBe(false);
    registry.dispose();
  });

  it("lets a client without a primary environment settle on its remotes", () => {
    const { catalog, shells, configs, settled, registry } = makeSettledHarness(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(settled)).toBe(true);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(settled)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    registry.set(configs(REMOTE), {});
    expect(registry.get(settled)).toBe(true);
    registry.dispose();
  });
});
