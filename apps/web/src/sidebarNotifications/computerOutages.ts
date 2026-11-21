import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import {
  isComputerOutagePhase,
  shownComputerOutages,
  trackComputerOutages,
} from "./sidebarNotifications.logic";

let starts: ReadonlyMap<EnvironmentId, number> = new Map();
let following = false;
const listeners = new Set<() => void>();

// Followed for the whole session from the first reader on, so an outage keeps its start
// while the footer remounts (the phone sheet closing, the sidebar going compact).
function follow() {
  if (following) return;
  following = true;
  appAtomRegistry.subscribe(
    environmentPresentations.presentationsAtom,
    (presentations) => {
      const next = trackComputerOutages(
        starts,
        [...presentations].map(([environmentId, presentation]) => ({
          environmentId,
          unreachable: isComputerOutagePhase(presentation.connection.phase),
        })),
        Date.now(),
      );
      if (next === starts) return;
      starts = next;
      for (const listener of listeners) listener();
    },
    { immediate: true },
  );
}

function subscribe(listener: () => void) {
  follow();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => starts;

/**
 * Unreachable computers by when they became so (`unreachable`), and those unreachable past the
 * grace, which get a card (`shown`).
 */
export function useComputerOutages() {
  const unreachable = useSyncExternalStore(subscribe, read, read);
  const [now, setNow] = useState(() => Date.now());
  const { shown, nextAt } = shownComputerOutages(unreachable, now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the clock: an outage's card shows once it passes the grace
  useEffect(() => {
    if (nextAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [nextAt]);
  return { unreachable, shown };
}
