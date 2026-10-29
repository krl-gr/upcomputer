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

import {
  filterSidebarThreadsBySettledEnvironment,
  resolveSidebarListVisibility,
} from "../components/Sidebar.logic";
import { resolveHomeWithoutDraft } from "../scratchHomeDraft";
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
    generation: status === "empty" ? 0 : 1,
    removedAt: new Map(),
  };
}

function catalogState(
  environmentIds: readonly EnvironmentId[],
  disabledEnvironmentIds: readonly EnvironmentId[] = [],
): EnvironmentCatalogState {
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
          enabled: !disabledEnvironmentIds.includes(environmentId),
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
  const delivery = () => registry.get(atoms.workspaceDeliveryAtom);
  // What the UpComputer sidebar and home show with no thread and no project.
  const emptyStates = () => ({
    sidebar: resolveSidebarListVisibility({
      surface: "upcomputer",
      workspaceKnown: known(),
      workspaceSettled: settled(),
      workspaceDelivered: delivery().delivered,
    }).emptyState,
    home: resolveHomeWithoutDraft({
      startsWithoutProject: true,
      workspaceSettled: settled(),
      workspaceDelivered: delivery().delivered,
    }),
  });
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
    delivery,
    emptyStates,
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

  it("does not claim an empty workspace at the deadline while an environment is connecting", () => {
    // Astra review G2: a slow cold start with no cache and no server config
    // reached the deadline and said "No threads yet", and home could show the
    // "Add a project" hero, while the live shell still had threads.
    const { catalog, connections, deadlinePassed, registry, settled, delivery, emptyStates } =
      makeHarness();
    registry.set(catalog, catalogState([LOCAL]));
    registry.set(connections(LOCAL), connection("connecting"));
    expect(emptyStates()).toEqual({ sidebar: "hidden", home: "pending" });
    registry.set(deadlinePassed, true);
    expect(settled()).toBe(true);
    expect(delivery()).toEqual({
      delivered: false,
      waitingOn: [{ environmentId: LOCAL, label: LOCAL, isPrimary: true, unreachable: false }],
    });
    expect(emptyStates()).toEqual({ sidebar: "waiting", home: "waiting" });
    registry.set(connections(LOCAL), connection("backoff", { attempt: 3 }));
    expect(delivery().waitingOn[0]?.unreachable).toBe(true);
    // The next retry does not turn "Can’t reach" back into "Connecting".
    registry.set(connections(LOCAL), connection("connecting", { attempt: 4 }));
    expect(delivery().waitingOn[0]?.unreachable).toBe(true);
    registry.dispose();
  });

  it("claims an empty workspace once every environment sent its live data", () => {
    const { catalog, shells, connections, configs, deadlinePassed, registry, emptyStates } =
      makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(connections(REMOTE), connection("backoff", { attempt: 3 }));
    registry.set(deadlinePassed, true);
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    // The remote's cache or failed connection proves nothing about its threads.
    registry.set(shells(REMOTE), shellState("cached"));
    expect(emptyStates()).toEqual({ sidebar: "waiting", home: "waiting" });
    registry.set(shells(REMOTE), shellState("live"));
    registry.set(configs(REMOTE), {});
    registry.set(connections(REMOTE), connection("connected"));
    expect(emptyStates()).toEqual({ sidebar: "empty", home: "hero" });
    // Proof does not expire: a later reconnect keeps the empty state.
    registry.set(shells(REMOTE), shellState("cached"));
    registry.set(connections(REMOTE), connection("backoff", { attempt: 1 }));
    expect(emptyStates()).toEqual({ sidebar: "empty", home: "hero" });
    registry.dispose();
  });

  it("does not wait for a remote the user switched off", () => {
    const { catalog, shells, connections, configs, registry, delivery, emptyStates } =
      makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE], [REMOTE]));
    registry.set(connections(REMOTE), connection("available", { desired: false }));
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    expect(delivery().delivered).toBe(true);
    expect(emptyStates()).toEqual({ sidebar: "empty", home: "hero" });
    registry.dispose();
  });

  it("waits for an enabled remote whose supervisor has not reported yet", () => {
    // Astra review G3: an enabled remote reads `available` (not desired) until
    // its supervisor reports, and counted as one the user does not connect to.
    const {
      catalog,
      shells,
      connections,
      configs,
      deadlinePassed,
      registry,
      delivery,
      emptyStates,
    } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    registry.set(configs(LOCAL), {});
    const seen = new Set<string>();
    const record = () => {
      const views = emptyStates();
      seen.add(views.sidebar).add(views.home);
    };
    registry.set(connections(REMOTE), AVAILABLE_CONNECTION_STATE);
    record();
    expect(delivery()).toEqual({
      delivered: false,
      waitingOn: [{ environmentId: REMOTE, label: REMOTE, isPrimary: false, unreachable: false }],
    });
    registry.set(connections(REMOTE), connection("connecting"));
    record();
    registry.set(deadlinePassed, true);
    record();
    expect(delivery().waitingOn).toMatchObject([{ environmentId: REMOTE, unreachable: false }]);
    expect(seen.has("empty")).toBe(false);
    expect(seen.has("hero")).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    registry.set(configs(REMOTE), {});
    registry.set(connections(REMOTE), connection("connected"));
    expect(emptyStates()).toEqual({ sidebar: "empty", home: "hero" });
    registry.dispose();
  });
});
