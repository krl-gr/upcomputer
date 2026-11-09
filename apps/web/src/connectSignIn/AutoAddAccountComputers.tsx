import {
  orchestrationProtocolCompatibilityError,
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { Discovery } from "@t3tools/client-runtime/relay";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useEffect, useEffectEvent, useState } from "react";

import { environmentCatalog } from "../connection/catalog";
import { toastManager } from "../components/ui/toast";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { useEnvironments, useRelayEnvironmentDiscovery } from "../state/environments";
import { relayEnvironmentDiscovery } from "../state/relay";
import { useAtomCommand } from "../state/use-atom-command";
import { computersToAdd, type DiscoveredComputer } from "./connectSignIn.logic";

/** Discovery lists the account's computers only when asked, so the app asks again on focus. */
const FOCUS_REFRESH_MIN_INTERVAL_MS = 60_000;

const KnownComputers = Schema.Array(EnvironmentId);
const knownComputersKey = (account: string) => `upcomputer:connect-known-computers:${account}`;

function readKnownComputers(account: string): ReadonlySet<EnvironmentId> {
  try {
    return new Set(getLocalStorageItem(knownComputersKey(account), KnownComputers) ?? []);
  } catch (error) {
    console.error("[t3-connect] Could not read this device's computers", error);
    return new Set();
  }
}

function writeKnownComputers(account: string, known: ReadonlySet<EnvironmentId>) {
  try {
    setLocalStorageItem(knownComputersKey(account), [...known], KnownComputers);
  } catch (error) {
    console.error("[t3-connect] Could not save this device's computers", error);
  }
}

function discoveredComputer(entry: Discovery.RelayDiscoveredEnvironment): DiscoveredComputer {
  const descriptor = Option.getOrNull(entry.status)?.descriptor;
  return {
    environmentId: entry.environment.environmentId,
    availability: entry.availability,
    compatible:
      descriptor === undefined || orchestrationProtocolCompatibilityError(descriptor) === null,
  };
}

/**
 * Adds the account's compatible computers this device lacks, including ones that join later.
 * Computers this device saved are remembered per account, so a removed one stays removed;
 * a fresh sign-in starts over, since signing out removes the account's computers.
 */
export function AutoAddAccountComputers({
  account,
  fresh,
  primaryEnvironmentId,
}: {
  readonly account: string;
  readonly fresh: boolean;
  readonly primaryEnvironmentId: EnvironmentId | null;
}) {
  const { environments, isReady } = useEnvironments();
  const discovery = useRelayEnvironmentDiscovery();
  const registerEnvironment = useAtomCommand(environmentCatalog.register, {
    reportFailure: false,
  });
  const refreshDiscovery = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const [attempted] = useState(() => new Set<EnvironmentId>());
  const [known, setKnown] = useState(() =>
    fresh ? new Set<EnvironmentId>() : readKnownComputers(account),
  );

  const saved = new Set(environments.map((environment) => environment.environmentId));
  const unrecorded = isReady ? [...saved].filter((id) => !known.has(id)) : [];
  if (unrecorded.length > 0) setKnown(new Set([...known, ...unrecorded]));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists this device's computers so a removed one stays removed after a restart
  useEffect(() => {
    writeKnownComputers(account, known);
  }, [account, known]);

  const addComputer = useEffectEvent(async (environmentId: EnvironmentId) => {
    const entry = discovery.environments.get(environmentId);
    if (entry === undefined) return;
    const { label } = entry.environment;
    const result = await registerEnvironment(
      new RelayConnectionRegistration({
        target: new RelayConnectionTarget({ environmentId, label }),
      }),
    );
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Environment added",
        description: `Connecting to ${label} through UpComputer Connect.`,
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const cause = squashAtomCommandFailure(result);
    console.error("[t3-connect] Could not add the account's computer", { environmentId, cause });
    toastManager.add({
      type: "error",
      title: `Could not add ${label}`,
      description:
        cause instanceof Error ? cause.message : "Could not connect through UpComputer Connect.",
    });
  });
  const addNewComputers = useEffectEvent(
    (discovered: typeof discovery.environments, catalogReady: boolean) => {
      if (!catalogReady) return;
      const ids = computersToAdd({
        discovered: [...discovered.values()].map(discoveredComputer),
        primaryEnvironmentId,
        saved,
        known,
        attempted,
      });
      for (const id of ids) {
        attempted.add(id);
        void addComputer(id);
      }
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- adds computers as relay discovery, an external store, reports them
  useEffect(() => {
    addNewComputers(discovery.environments, isReady);
  }, [discovery.environments, isReady]);

  const refreshWhenIdle = useEffectEvent(() => {
    if (!discovery.refreshing) void refreshDiscovery();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the relay for the account's computers at launch and when the window comes back
  useEffect(() => {
    let lastRefresh = Date.now();
    refreshWhenIdle();
    const onActive = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
      lastRefresh = Date.now();
      refreshWhenIdle();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, []);

  return null;
}
