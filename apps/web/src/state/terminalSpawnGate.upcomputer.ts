import type { TerminalGridSize } from "@t3tools/client-runtime/state/terminal";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";

/**
 * Up.computer: a shell draws its first prompt at the PTY's starting grid. Starting
 * it at a default size and resizing it afterwards leaves a stale copy of a long,
 * wrapped prompt above the redrawn one, so a new shell waits for the viewport's grid.
 */
interface TerminalSpawnGate {
  /** The latest grid a visible viewport measured, or null before the first one. */
  readonly grid: TerminalGridSize | null;
  /** Launch opens in flight. The viewport attaches after them so the launch's open starts the shell. */
  readonly launches: number;
}

const INITIAL_TERMINAL_SPAWN_GATE: TerminalSpawnGate = { grid: null, launches: 0 };

interface TerminalTarget {
  readonly threadId: string;
  readonly terminalId?: string | undefined;
}

const gateKey = (environmentId: EnvironmentId, terminal: TerminalTarget) =>
  JSON.stringify([environmentId, terminal.threadId, terminal.terminalId ?? null]);

// Not kept alive: the gate resets once no viewport or launch holds it.
const terminalSpawnGateFamily = Atom.family((key: string) =>
  Atom.make(INITIAL_TERMINAL_SPAWN_GATE).pipe(Atom.withLabel(`web-terminal-spawn-gate:${key}`)),
);

// A boolean, so later grids do not recompute the session atoms that read it.
const terminalAttachReadyFamily = Atom.family((key: string) =>
  Atom.make((get) => {
    const gate = get(terminalSpawnGateFamily(key));
    return gate.grid !== null && gate.launches === 0;
  }).pipe(Atom.withLabel(`web-terminal-attach-ready:${key}`)),
);

/** Whether an attach, which can start the shell, may subscribe: a grid is known and no launch open is in flight. */
export function terminalAttachReadyAtom(
  environmentId: EnvironmentId,
  terminal: TerminalTarget,
): Atom.Atom<boolean> {
  return terminalAttachReadyFamily(gateKey(environmentId, terminal));
}

/**
 * The grid an unanswered first attach sends, read when it subscribes. It is not
 * part of the attach key, so a remount reuses the live attach and a reconnect
 * resubscribes without a size.
 */
export function terminalFirstAttachGrid(
  environmentId: EnvironmentId,
  terminal: TerminalTarget,
): TerminalGridSize | null {
  return appAtomRegistry.get(terminalSpawnGateFamily(gateKey(environmentId, terminal))).grid;
}

/** A viewport measured its grid. A new shell starts at the latest one. */
export function reportTerminalViewportGrid(
  environmentId: EnvironmentId,
  terminal: TerminalTarget,
  grid: TerminalGridSize,
): void {
  const atom = terminalSpawnGateFamily(gateKey(environmentId, terminal));
  const gate = appAtomRegistry.get(atom);
  if (gate.grid?.cols === grid.cols && gate.grid.rows === grid.rows) return;
  appAtomRegistry.set(atom, { ...gate, grid: { cols: grid.cols, rows: grid.rows } });
}

/**
 * Holds a new terminal's viewport attach until `release`, so the launch's own
 * open starts the shell. `grid` waits up to `timeoutMs` for the viewport's
 * measured grid; null means the open falls back to the server's default size.
 */
export function holdTerminalSpawn(
  environmentId: EnvironmentId,
  terminal: TerminalTarget,
  timeoutMs: number,
): { readonly grid: Promise<TerminalGridSize | null>; readonly release: () => void } {
  const atom = terminalSpawnGateFamily(gateKey(environmentId, terminal));
  const update = (change: number) => {
    const gate = appAtomRegistry.get(atom);
    appAtomRegistry.set(atom, { ...gate, launches: Math.max(0, gate.launches + change) });
  };
  let stopWaiting = () => {};
  const grid = new Promise<TerminalGridSize | null>((resolve) => {
    const timer = setTimeout(() => stopWaiting(), timeoutMs);
    let unsubscribe: (() => void) | null = null;
    stopWaiting = () => {
      clearTimeout(timer);
      unsubscribe?.();
      unsubscribe = null;
      resolve(appAtomRegistry.get(atom).grid);
    };
    // Subscribing also keeps the gate alive before the viewport mounts.
    unsubscribe = appAtomRegistry.subscribe(atom, (gate) => {
      if (gate.grid !== null) stopWaiting();
    });
  });
  // The subscription above mounted the gate, so the count survives until release.
  update(1);
  let released = false;
  return {
    grid,
    release: () => {
      if (released) return;
      released = true;
      update(-1);
      stopWaiting();
    },
  };
}
