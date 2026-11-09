import { useAtomValue } from "@effect/atom-react";
import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  selectRunningSubprocessTerminalIds,
  type KnownTerminalSession,
  type TerminalGridSize,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import {
  EnvironmentId,
  ThreadId,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  TerminalAttachInput,
  type TerminalSummary,
} from "@t3tools/contracts";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { isProductFeatureShown } from "../product/productFlags";
import { formatEnvironmentQueryError } from "./query";
import { terminalEnvironment } from "./terminal";
import { environmentSession, sessionHasScope, useEnvironmentScope } from "./session";

const EMPTY_KNOWN_TERMINAL_SESSIONS = Object.freeze<ReadonlyArray<KnownTerminalSession>>([]);

interface TerminalMetadataIndex {
  readonly all: ReadonlyArray<TerminalSummary>;
  readonly byThreadId: ReadonlyMap<string, ReadonlyArray<TerminalSummary>>;
  readonly views: Map<EnvironmentId, Map<ThreadId | null, ReadonlyArray<KnownTerminalSession>>>;
}

const metadataIndexes = new WeakMap<ReadonlyArray<TerminalSummary>, TerminalMetadataIndex>();
const sessionsBySummary = new WeakMap<TerminalSummary, Map<EnvironmentId, KnownTerminalSession>>();
// Reuse held groups without retaining old members when their anchor survives in newer snapshots.
const groupsByAnchor = new WeakMap<
  TerminalSummary,
  Map<
    EnvironmentId,
    {
      readonly all?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
      readonly thread?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
    }
  >
>();

function knownSession(
  summary: TerminalSummary,
  environmentId: EnvironmentId,
): KnownTerminalSession {
  let byEnvironment = sessionsBySummary.get(summary);
  const previous = byEnvironment?.get(environmentId);
  if (previous) return previous;
  const session = {
    target: {
      environmentId,
      threadId: ThreadId.make(summary.threadId),
      terminalId: summary.terminalId,
    },
    state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
  };
  if (!byEnvironment) {
    byEnvironment = new Map();
    sessionsBySummary.set(summary, byEnvironment);
  }
  byEnvironment.set(environmentId, session);
  return session;
}

function terminalMetadataIndex(metadata: ReadonlyArray<TerminalSummary>): TerminalMetadataIndex {
  let index = metadataIndexes.get(metadata);
  if (!index) {
    const compare = new Intl.Collator(undefined, { numeric: true }).compare;
    const all = metadata.toSorted((left, right) => compare(left.terminalId, right.terminalId));
    const byThreadId = new Map<string, TerminalSummary[]>();
    for (const summary of all) {
      const group = byThreadId.get(summary.threadId);
      if (group) group.push(summary);
      else byThreadId.set(summary.threadId, [summary]);
    }
    index = { all, byThreadId, views: new Map() };
    metadataIndexes.set(metadata, index);
  }
  return index;
}

export function selectKnownTerminalSessions(
  metadata: ReadonlyArray<TerminalSummary> | null,
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ReadonlyArray<KnownTerminalSession> {
  if (environmentId === null || metadata === null || metadata.length === 0) {
    return EMPTY_KNOWN_TERMINAL_SESSIONS;
  }
  const index = terminalMetadataIndex(metadata);
  let views = index.views.get(environmentId);
  const cached = views?.get(threadId);
  if (cached) return cached;
  const summaries = threadId === null ? index.all : index.byThreadId.get(threadId);
  if (!summaries || summaries.length === 0) return EMPTY_KNOWN_TERMINAL_SESSIONS;

  const anchor = summaries[0]!;
  const kind = threadId === null ? "all" : "thread";
  let groups = groupsByAnchor.get(anchor);
  const previousGroups = groups?.get(environmentId);
  const previous = previousGroups?.[kind]?.deref();
  const sessions =
    previous?.length === summaries.length &&
    previous.every((session, index) => session.state.summary === summaries[index])
      ? previous
      : summaries.map((summary) => knownSession(summary, environmentId));
  if (!groups) {
    groups = new Map();
    groupsByAnchor.set(anchor, groups);
  }
  if (sessions !== previous) {
    groups.set(environmentId, { ...previousGroups, [kind]: new WeakRef(sessions) });
  }
  if (!views) {
    views = new Map();
    index.views.set(environmentId, views);
  }
  views.set(threadId, sessions);
  return sessions;
}

const EMPTY_TERMINAL_SESSION_ATOM = Atom.make(EMPTY_TERMINAL_SESSION_STATE).pipe(
  Atom.withLabel("web-terminal-session:empty"),
);

/**
 * A shell draws its first prompt at the PTY's starting grid. Starting it at a
 * default size and resizing it to the viewport afterwards leaves a stale copy of
 * a long, wrapped prompt above the redrawn one, so a new shell waits for this.
 */
interface TerminalSpawnGate {
  /** The grid the first visible viewport measured; set once per mount. */
  readonly grid: TerminalGridSize | null;
  /** Launch opens in flight. The viewport attaches after them so the launch's open starts the shell. */
  readonly launches: number;
}

const INITIAL_TERMINAL_SPAWN_GATE: TerminalSpawnGate = { grid: null, launches: 0 };

// Not kept alive: the gate resets once no viewport or launch holds it.
const terminalSpawnGateFamily = Atom.family((key: string) =>
  Atom.make(INITIAL_TERMINAL_SPAWN_GATE).pipe(Atom.withLabel(`web-terminal-spawn-gate:${key}`)),
);

interface TerminalTarget {
  readonly threadId: string;
  readonly terminalId: string;
}

function terminalSpawnGateAtom(environmentId: EnvironmentId, terminal: TerminalTarget) {
  return terminalSpawnGateFamily(
    JSON.stringify([environmentId, terminal.threadId, terminal.terminalId]),
  );
}

/** A viewport measured its grid; the first one sets the size a new shell starts at. */
export function reportTerminalViewportGrid(
  environmentId: EnvironmentId,
  terminal: TerminalTarget,
  grid: TerminalGridSize,
): void {
  const atom = terminalSpawnGateAtom(environmentId, terminal);
  const gate = appAtomRegistry.get(atom);
  if (gate.grid === null) appAtomRegistry.set(atom, { ...gate, grid });
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
  const atom = terminalSpawnGateAtom(environmentId, terminal);
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

const decodeAttachKey = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Tuple([EnvironmentId, TerminalAttachInput])),
);

// The family key carries the whole launch so an idle atom leaves nothing behind.
const attachedTerminalSessionFamily = Atom.family((key: string) => {
  const decoded = decodeAttachKey(key);
  if (Option.isNone(decoded)) {
    return Atom.make<TerminalSessionState>({
      ...EMPTY_TERMINAL_SESSION_STATE,
      error: "Invalid terminal launch input",
      status: "error",
    }).pipe(Atom.withLabel(`web-terminal-session:${key}`));
  }
  const [environmentId, terminal] = decoded.value;
  return Atom.make((get): TerminalSessionState => {
    const session = get(environmentSession.sessionStateAtom(environmentId));
    const canRead = sessionHasScope(session, AuthTerminalReadScope);
    const canOperate = sessionHasScope(session, AuthTerminalOperateScope);
    // Attaching can start the shell, so it waits for the viewport's grid and any launch open.
    const gate = canOperate ? get(terminalSpawnGateAtom(environmentId, terminal)) : null;
    const attach = canOperate
      ? gate?.grid && gate.launches === 0
        ? get(
            terminalEnvironment.attach({
              environmentId,
              input: { ...terminal, cols: gate.grid.cols, rows: gate.grid.rows },
            }),
          )
        : null
      : canRead
        ? get(
            terminalEnvironment.observe({
              environmentId,
              input: { threadId: terminal.threadId, terminalId: terminal.terminalId },
            }),
          )
        : null;
    const metadata = canRead
      ? AsyncResult.getOrElse(
          get(terminalEnvironment.metadata({ environmentId, input: null })),
          () => null,
        )
      : null;
    const summary =
      (metadata === null
        ? null
        : terminalMetadataIndex(metadata)
            .byThreadId.get(terminal.threadId)
            ?.find((candidate) => candidate.terminalId === terminal.terminalId)) ?? null;
    const buffer =
      attach === null
        ? EMPTY_TERMINAL_BUFFER_STATE
        : AsyncResult.getOrElse(attach, () => EMPTY_TERMINAL_BUFFER_STATE);
    const state = combineTerminalSessionState(summary, buffer);
    return attach?._tag === "Failure"
      ? { ...state, error: formatEnvironmentQueryError(attach.cause), status: "error" }
      : state;
  }).pipe(Atom.withLabel(`web-terminal-session:${key}`));
});

/**
 * One shown terminal's session: its attach (or read-only observe) buffer
 * combined with the metadata summary. Surfaces subscribe to it imperatively so
 * output chunks never re-render React.
 */
export function attachedTerminalSessionAtom(
  environmentId: EnvironmentId | null,
  terminal: TerminalAttachInput | null,
): Atom.Atom<TerminalSessionState> {
  if (environmentId === null || terminal === null) return EMPTY_TERMINAL_SESSION_ATOM;
  return attachedTerminalSessionFamily(JSON.stringify([environmentId, terminal]));
}

const NO_KNOWN_TERMINAL_SESSIONS_ATOM = Atom.make<ReadonlyArray<KnownTerminalSession> | null>(null);

const decodeKnownSessionsKey = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Tuple([EnvironmentId, Schema.NullOr(ThreadId)])),
);

// Derived per thread, so a terminal update elsewhere in the environment notifies no one here.
const knownTerminalSessionsFamily = Atom.family((key: string) => {
  const [environmentId, threadId] = Option.getOrThrow(decodeKnownSessionsKey(key));
  return Atom.make((get) => {
    const metadata = get(terminalEnvironment.metadata({ environmentId, input: null }));
    return metadata._tag === "Success"
      ? selectKnownTerminalSessions(metadata.value, environmentId, threadId)
      : null;
  }).pipe(Atom.withLabel(`web-known-terminal-sessions:${key}`));
});

export function knownTerminalSessionsAtom(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): Atom.Atom<ReadonlyArray<KnownTerminalSession> | null> {
  return knownTerminalSessionsFamily(JSON.stringify([environmentId, threadId]));
}

export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<KnownTerminalSession> | null {
  const canRead = useEnvironmentScope(input.environmentId, AuthTerminalReadScope);
  return useAtomValue(
    input.environmentId === null || !canRead || !isProductFeatureShown("terminalSurface")
      ? NO_KNOWN_TERMINAL_SESSIONS_ATOM
      : knownTerminalSessionsAtom(input.environmentId, input.threadId),
  );
}

export function useThreadRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<string> {
  // Running terminals show on thread rows, which the terminal surface alone leaves out.
  const sessions = useKnownTerminalSessions(
    isProductFeatureShown("terminal") ? input : { environmentId: null, threadId: null },
  );
  return selectRunningSubprocessTerminalIds(sessions ?? []);
}
