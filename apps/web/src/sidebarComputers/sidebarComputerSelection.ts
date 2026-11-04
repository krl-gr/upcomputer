import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { environmentCatalog } from "../connection/catalog";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { useThreadSelectionStore } from "../threadSelectionStore";
import {
  computerScopeOf,
  filterToComputerScope,
  resolveComputerSelection,
  type ComputerChoice,
  type ComputerSelection,
} from "./sidebarComputers.logic";

const STORAGE_KEY = "upcomputer:sidebar-computer";

interface StoreState {
  /** The person's pick; null until they pick, which means this computer. */
  readonly saved: ComputerChoice | null;
  /** The last open thread the sidebar followed; in memory, so a restart follows the open thread. */
  readonly revealedRouteKey: string | null;
}

function readSaved(): ComputerChoice | null {
  try {
    const value = getLocalStorageItem(STORAGE_KEY, Schema.String);
    return value === null ? null : value === "all" ? "all" : EnvironmentId.make(value);
  } catch {
    return null;
  }
}

let state: StoreState = { saved: readSaved(), revealedRouteKey: null };
const listeners = new Set<() => void>();

function update(next: StoreState) {
  if (next.saved !== state.saved) {
    try {
      setLocalStorageItem(STORAGE_KEY, next.saved ?? "all", Schema.String);
    } catch {
      // A full or blocked storage keeps the pick for this session only.
    }
  }
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getState = () => state;

/** Shows one computer, or all of them, in the sidebar, Bots, Tasks and Workers. */
export function selectSidebarComputer(choice: ComputerChoice) {
  if (choice === state.saved) return;
  // A selection made on one computer can hold threads the next one hides.
  useThreadSelectionStore.getState().clearSelection();
  update({ ...state, saved: choice });
}

/** The open thread was followed: later picks hold while it stays open. */
export function markSidebarComputerRouteRevealed(routeKey: string, choice: ComputerChoice | null) {
  if (routeKey === state.revealedRouteKey && choice === null) return;
  update({ saved: choice ?? state.saved, revealedRouteKey: routeKey });
}

/** Saved and connected computers the Computers section lists after All computers: this computer first, then the catalog's order. */
const knownComputerIdsAtom = Atom.make((get) => {
  const enabled: EnvironmentId[] = [];
  const primary = get(primaryEnvironmentIdAtom);
  if (primary !== null) enabled.push(primary);
  for (const [environmentId, entry] of get(environmentCatalog.catalogValueAtom).entries) {
    if (entry.enabled && environmentId !== primary) enabled.push(environmentId);
  }
  const previous = Option.getOrNull(get.self<ReadonlyArray<EnvironmentId>>());
  return previous !== null &&
    previous.length === enabled.length &&
    enabled.every((id, index) => id === previous[index])
    ? previous
    : enabled;
}).pipe(Atom.withLabel("upcomputer-sidebar-known-computers"));

function useComputerRoute() {
  const params = useParams({ strict: false }) as {
    readonly environmentId?: string;
    readonly threadId?: string;
  };
  const environmentId = params.environmentId ?? null;
  const threadId = params.threadId ?? null;
  return { environmentId, threadId };
}

/** The Computers section's state: whether it shows, and the computer the sidebar shows. */
export function useSidebarComputerSelection(): ComputerSelection & {
  readonly computerIds: ReadonlyArray<EnvironmentId>;
  readonly routeKey: string | null;
} {
  const computerIds = useAtomValue(knownComputerIdsAtom);
  const primaryId = useAtomValue(primaryEnvironmentIdAtom);
  const { saved, revealedRouteKey } = useSyncExternalStore(subscribe, getState, getState);
  const { environmentId, threadId } = useComputerRoute();
  const route =
    environmentId === null || threadId === null
      ? null
      : {
          key: scopedThreadKey(
            scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId)),
          ),
          environmentId: EnvironmentId.make(environmentId),
        };
  const selection = resolveComputerSelection({
    saved,
    computerIds,
    primaryId,
    route,
    revealedRouteKey,
  });
  return { ...selection, computerIds, routeKey: route?.key ?? null };
}

const scopeCache = new Map<ComputerChoice, ReadonlySet<EnvironmentId> | null>();
function scopeForChoice(choice: ComputerChoice): ReadonlySet<EnvironmentId> | null {
  let scope = scopeCache.get(choice);
  if (scope === undefined) {
    scope = computerScopeOf({ shown: true, choice, revealsRoute: false });
    scopeCache.set(choice, scope);
  }
  return scope;
}

/** The computers the sidebar shows, or null for all; one Set per choice, so memos hold. */
export function useSidebarComputerScope(): ReadonlySet<EnvironmentId> | null {
  const selection = useSidebarComputerSelection();
  return scopeForChoice(selection.shown ? selection.choice : "all");
}

/** The one computer the sidebar shows, for actions outside React; null in All computers. */
function readSidebarComputerId(): EnvironmentId | null {
  const selection = resolveComputerSelection({
    saved: state.saved,
    computerIds: appAtomRegistry.get(knownComputerIdsAtom),
    primaryId: appAtomRegistry.get(primaryEnvironmentIdAtom),
    route: null,
    revealedRouteKey: null,
  });
  return selection.shown && selection.choice !== "all" ? selection.choice : null;
}

/** The projects of the computer the sidebar shows; every project when not `scoped`. */
export function useSidebarComputerProjects<T extends { readonly environmentId: EnvironmentId }>(
  projects: ReadonlyArray<T>,
  scoped: boolean,
): ReadonlyArray<T> {
  const scope = useSidebarComputerScope();
  return filterToComputerScope(projects, scoped ? scope : null);
}

/**
 * Where a chat without a project starts: the computer the sidebar shows when
 * it offers one, else upstream's rule (this computer first).
 */
export function sidebarComputerScratchTarget(
  scratch: {
    readonly scratchEnvironmentId: (fallback: EnvironmentId | null) => EnvironmentId | null;
    readonly scratchWorkspaceRootFor: (environmentId: EnvironmentId | null) => string | null;
  },
  fallback: EnvironmentId | null,
): EnvironmentId | null {
  const selected = readSidebarComputerId();
  return selected !== null && scratch.scratchWorkspaceRootFor(selected) !== null
    ? selected
    : scratch.scratchEnvironmentId(fallback);
}
