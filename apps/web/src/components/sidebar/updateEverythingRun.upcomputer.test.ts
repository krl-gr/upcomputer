import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { ServerUpdateTarget } from "../ServerUpdateAction";
import {
  type UpdateEverythingRun,
  type UpdateRunMachine,
  withoutRecoveredMachines,
} from "./updateEverything.logic";
import {
  dismissSettledUpdateRunMachines,
  retryFailedUpdateRunServers,
  setUpdateEverythingRun,
  visibleUpdateEverythingRunAtom,
} from "./updateEverythingRun";

const macbook = EnvironmentId.make("macbook");
const studio = EnvironmentId.make("studio");

const target = (environmentId: EnvironmentId): ServerUpdateTarget => ({
  environmentId,
  serverLabel: environmentId,
  selfUpdate: "desktop-managed",
  desktopAppUpdate: true,
  targetVersion: "0.0.38-nightly.20261108.749",
});

const failedMachine = (
  environmentId: EnvironmentId,
  server: ServerUpdateTarget | null = target(environmentId),
): UpdateRunMachine => ({
  environmentId,
  label: environmentId,
  updatesProviders: server === null,
  server,
  handedOffVersion: null,
  startedAt: 0,
  result: "failed",
  failure: "Could not update",
  providerFailure: null,
});

const failedRun = (...machines: UpdateRunMachine[]): UpdateEverythingRun => ({
  localVersion: null,
  phase: "servers",
  restartAt: null,
  machines,
});

describe("withoutRecoveredMachines", () => {
  it("drops a failed server once it is no longer behind, and closes an emptied run", () => {
    const run = failedRun(failedMachine(macbook), failedMachine(studio, null));
    const versions = new Map<EnvironmentId, string | null>([
      [macbook, "0.0.38-nightly.20261107.748"],
    ]);
    const versionOf = (id: EnvironmentId) => versions.get(id) ?? null;

    // Still behind, or a provider-only failure: the run stays as it was.
    expect(withoutRecoveredMachines(run, versionOf)).toBe(run);
    // Updated by hand to this app's version: only the provider failure remains.
    versions.set(macbook, "0.0.38-nightly.20261108.749");
    expect(withoutRecoveredMachines(run, versionOf)?.machines).toEqual([
      failedMachine(studio, null),
    ]);
    expect(withoutRecoveredMachines(failedRun(failedMachine(macbook)), versionOf)).toBeNull();
  });
});

describe("update everything run", () => {
  it("counts a host whose desktop app is already up to date as done on retry", async () => {
    setUpdateEverythingRun(() => failedRun(failedMachine(macbook)));
    let retried: Promise<unknown> = Promise.resolve();
    retryFailedUpdateRunServers((_target) => {
      const outcome = Promise.resolve({ status: "current" as const, version: "0.0.37" });
      retried = outcome;
      return outcome;
    });
    await retried;
    expect(appAtomRegistry.get(visibleUpdateEverythingRunAtom)).toBeNull();
  });

  it("dismisses a failed run", () => {
    setUpdateEverythingRun(() => failedRun(failedMachine(macbook)));
    expect(appAtomRegistry.get(visibleUpdateEverythingRunAtom)?.machines).toHaveLength(1);
    dismissSettledUpdateRunMachines();
    expect(appAtomRegistry.get(visibleUpdateEverythingRunAtom)).toBeNull();
  });
});
