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

import { filterSidebarThreadsBySettledEnvironment } from "../components/Sidebar.logic";
import { createWorkspaceAtoms } from "./workspace";

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

function connection(
  phase: SupervisorConnectionState["phase"],
  overrides: Partial<SupervisorConnectionState> = {},
): SupervisorConnectionState {
  return { ...AVAILABLE_CONNECTION_STATE, phase, desired: phase !== "available", ...overrides };
}

function makeHarness(expectsPrimary = true) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const connections = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<SupervisorConnectionState | null>(null),
  );
  const configs = Atom.family((_environmentId: EnvironmentId) => Atom.make<unknown>(null));
  const deadlinePassed = Atom.make(false);
  const atoms = createWorkspaceAtoms({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    connectionStateAtom: connections,
    serverConfigValueAtom: configs,
    expectsPrimaryEnvironment: () => expectsPrimary,
    deadlinePassedAtom: deadlinePassed,
  });
  const registry = AtomRegistry.make();
  const known = () => registry.get(atoms.workspaceKnownAtom);
  const settled = () => registry.get(atoms.workspaceSettledAtom);
  const settledEnvironments = () => registry.get(atoms.settledEnvironmentIdsAtom);
  return {
    catalog,
    shells,
    connections,
    configs,
    deadlinePassed,
    registry,
    known,
    settled,
    settledEnvironments,
  };
}

describe("workspace readiness", () => {
  it("does not treat a catalog with only a disconnected remote as an empty workspace", () => {
    const { catalog, connections, registry, settled, known } = makeHarness();
    expect(settled()).toBe(false);
    // The relaunch that showed the "Add a project" hero: the persisted catalog
    // held only a managed VM that was not connected, the primary not yet registered.
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(connections(REMOTE), connection("offline"));
    expect(settled()).toBe(false);
    expect(known()).toBe(false);
    registry.dispose();
  });

  it("waits for the primary's live shell and server config, not its cache", () => {
    const { catalog, shells, connections, configs, registry, settled } = makeHarness();
    registry.set(catalog, catalogState([LOCAL]));
    registry.set(connections(LOCAL), connection("available", { desired: false }));
    expect(settled()).toBe(false);
    registry.set(shells(LOCAL), shellState("cached"));
    registry.set(connections(LOCAL), connection("connecting"));
    expect(settled()).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(connections(LOCAL), connection("connected"));
    expect(settled()).toBe(false);
    registry.set(configs(LOCAL), { scratchWorkspaceRoot: "/scratch" });
    expect(settled()).toBe(true);
    registry.dispose();
  });

  it("lets home use the cached shell once the primary and its server config are known", () => {
    const { catalog, shells, configs, registry, known, settled } = makeHarness();
    registry.set(catalog, catalogState([LOCAL]));
    registry.set(shells(LOCAL), shellState("cached"));
    expect(known()).toBe(false);
    registry.set(configs(LOCAL), { scratchWorkspaceRoot: "/scratch" });
    expect(known()).toBe(true);
    expect(settled()).toBe(false);
    registry.dispose();
  });

  it("does not wait for an environment that settled without data", () => {
    const { catalog, shells, connections, configs, registry, settled } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    registry.set(connections(REMOTE), connection("backoff", { attempt: 1 }));
    expect(settled()).toBe(false);
    registry.set(connections(REMOTE), connection("backoff", { attempt: 3 }));
    expect(settled()).toBe(true);
    registry.dispose();
  });

  it("never hides the workspace again when a remote reconnects or its stream fails", () => {
    // Astra review G: the gate was recomputed on every connection change, so
    // a remote going from backoff to connecting unmounted every thread row.
    const { catalog, shells, connections, configs, registry, settled, settledEnvironments } =
      makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    registry.set(connections(REMOTE), connection("backoff", { attempt: 3 }));
    expect(settled()).toBe(true);
    for (const phase of ["connecting", "backoff", "connecting", "connected"] as const) {
      registry.set(connections(REMOTE), connection(phase, { attempt: 4 }));
      expect(settled()).toBe(true);
      expect(settledEnvironments().has(LOCAL)).toBe(true);
    }
    // The primary's shell stream failing while its transport stays connected.
    registry.set(shells(LOCAL), shellState("cached"));
    registry.set(connections(LOCAL), connection("connected"));
    expect(settled()).toBe(true);
    expect(settledEnvironments().has(LOCAL)).toBe(true);
    registry.dispose();
  });

  it("shows each environment's rows on its own", () => {
    const { catalog, shells, connections, configs, registry, settled, settledEnvironments } =
      makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(connections(REMOTE), connection("connecting"));
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    // The remote is still connecting: the workspace is not settled, but the
    // primary's threads already show.
    expect(settled()).toBe(false);
    const threads = [
      { id: "local-thread", environmentId: LOCAL },
      { id: "remote-thread", environmentId: REMOTE },
    ];
    expect(
      filterSidebarThreadsBySettledEnvironment(threads, "upcomputer", settledEnvironments()).map(
        (thread) => thread.id,
      ),
    ).toEqual(["local-thread"]);
    expect(filterSidebarThreadsBySettledEnvironment(threads, "upstream", new Set())).toBe(threads);
    registry.set(shells(REMOTE), shellState("live"));
    registry.set(configs(REMOTE), {});
    expect(settled()).toBe(true);
    expect(
      filterSidebarThreadsBySettledEnvironment(threads, "upcomputer", settledEnvironments()),
    ).toBe(threads);
    registry.dispose();
  });

  it("ends the first load at the deadline with what it knows", () => {
    // A shell stream that errors while its transport stays connected never
    // settles; the deadline shows its cached rows instead of waiting forever.
    const { catalog, shells, connections, deadlinePassed, registry, known, settled } =
      makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("cached"));
    registry.set(connections(LOCAL), connection("connected"));
    registry.set(connections(REMOTE), connection("connecting"));
    expect(known()).toBe(false);
    expect(settled()).toBe(false);
    registry.set(deadlinePassed, true);
    expect(known()).toBe(true);
    expect(settled()).toBe(true);
    registry.dispose();
  });

  it("lets a client without a primary environment settle on its remotes", () => {
    const { catalog, shells, configs, registry, settled } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(settled()).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    registry.set(configs(REMOTE), {});
    expect(settled()).toBe(true);
    registry.dispose();
  });
});
