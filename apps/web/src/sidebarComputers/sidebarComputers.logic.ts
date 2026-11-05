import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../components/Sidebar.logic";
import type { RunCountGroup } from "../sidebarThreadRow/runCountBadge";
import { THREAD_STATUS_LABELS } from "../sidebarThreadRow/ThreadStatusLabel";

/*
 * The sidebar's Computers section (UpComputer): which computer the sidebar,
 * Bots, Tasks and Workers show. "all" lists every computer in one list.
 */

export type ComputerChoice = EnvironmentId | "all";

export interface ComputerRoute {
  /** The open thread's scoped key, `${environmentId}:${threadId}`. */
  readonly key: string;
  readonly environmentId: EnvironmentId;
}

export interface ComputerSelection {
  /** Two or more computers are known, so the section shows and filters. */
  readonly shown: boolean;
  readonly choice: ComputerChoice;
  /** The open thread is on another computer than the saved choice, which switches to it. */
  readonly revealsRoute: boolean;
}

/**
 * The computer the sidebar shows. A saved computer that is gone falls back to
 * this computer (the primary). Opening a thread on another computer switches
 * to it once per route change, so a later pick still holds while it stays open.
 */
export function resolveComputerSelection(input: {
  readonly saved: ComputerChoice | null;
  readonly computerIds: ReadonlyArray<EnvironmentId>;
  readonly primaryId: EnvironmentId | null;
  readonly route: ComputerRoute | null;
  readonly revealedRouteKey: string | null;
}): ComputerSelection {
  const { saved, computerIds, primaryId, route, revealedRouteKey } = input;
  if (computerIds.length < 2) return { shown: false, choice: "all", revealsRoute: false };
  const known = (id: EnvironmentId | null): id is EnvironmentId =>
    id !== null && computerIds.includes(id);
  const base: ComputerChoice =
    saved === "all" ? "all" : known(saved) ? saved : known(primaryId) ? primaryId : "all";
  const revealsRoute =
    route !== null &&
    route.key !== revealedRouteKey &&
    base !== "all" &&
    base !== route.environmentId &&
    known(route.environmentId);
  return { shown: true, choice: revealsRoute ? route.environmentId : base, revealsRoute };
}

/** The computers a selection shows, or null for every computer. */
export function computerScopeOf(selection: ComputerSelection): ReadonlySet<EnvironmentId> | null {
  return selection.shown && selection.choice !== "all" ? new Set([selection.choice]) : null;
}

export function filterToComputerScope<T extends { readonly environmentId: EnvironmentId }>(
  items: ReadonlyArray<T>,
  scope: ReadonlySet<EnvironmentId> | null,
): ReadonlyArray<T> {
  return scope === null ? items : items.filter((item) => scope.has(item.environmentId));
}

export function filterIdsToComputerScope(
  ids: ReadonlyArray<EnvironmentId>,
  scope: ReadonlySet<EnvironmentId> | null,
): ReadonlyArray<EnvironmentId> {
  return scope === null ? ids : ids.filter((id) => scope.has(id));
}

export function filterMapToComputerScope<V>(
  map: ReadonlyMap<EnvironmentId, V>,
  scope: ReadonlySet<EnvironmentId> | null,
): ReadonlyMap<EnvironmentId, V> {
  return scope === null ? map : new Map([...map].filter(([id]) => scope.has(id)));
}

/**
 * Project keys (`${environmentId}:${projectId}`) a project-keyed list (drafts)
 * shows: the project scope, narrowed to the selected computer.
 */
export function projectKeysInComputerScope(input: {
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly projects: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: string }>;
  readonly scope: ReadonlySet<EnvironmentId> | null;
}): ReadonlySet<string> | null {
  const { scopedProjectKeys, projects, scope } = input;
  if (scope === null) return scopedProjectKeys;
  const keys = filterToComputerScope(projects, scope).map(
    (project) => `${project.environmentId}:${project.id}`,
  );
  return new Set(
    scopedProjectKeys === null ? keys : keys.filter((key) => scopedProjectKeys.has(key)),
  );
}

export interface ComputerRunCounts {
  readonly working: number;
  readonly input: number;
  readonly approval: number;
  readonly failed: number;
}

export const NO_COMPUTER_RUNS: ComputerRunCounts = { working: 0, input: 0, approval: 0, failed: 0 };

/**
 * Each computer's runs by the status its thread rows show. Subagent children
 * report through their parent, so only top-level threads count. A failed run
 * counts until its thread is opened: one already seen asks nothing more.
 */
export function countComputerRuns(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  localLastVisitedAtByKey: Readonly<Record<string, string>>,
): ReadonlyMap<EnvironmentId, ComputerRunCounts> {
  const counts = new Map<EnvironmentId, ComputerRunCounts>();
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.lineage.relationshipToParent === "subagent") continue;
    const status = resolveSidebarThreadStatus(thread);
    const kind: keyof ComputerRunCounts | null =
      status === "working"
        ? "working"
        : status === "input" || status === "request"
          ? "input"
          : status === "approval"
            ? "approval"
            : (status === "failed" || status === "limited") &&
                failureUnseen(thread, localLastVisitedAtByKey)
              ? "failed"
              : null;
    if (kind === null) continue;
    const current = counts.get(thread.environmentId) ?? NO_COMPUTER_RUNS;
    counts.set(thread.environmentId, { ...current, [kind]: current[kind] + 1 });
  }
  return counts;
}

function failureUnseen(
  thread: EnvironmentThreadShell,
  localLastVisitedAtByKey: Readonly<Record<string, string>>,
): boolean {
  const lastVisitedAt = resolveThreadLastVisitedAt(
    thread.lastVisitedAt,
    localLastVisitedAtByKey[`${thread.environmentId}:${thread.id}`],
  );
  if (!lastVisitedAt) return true;
  const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
  const visitedAt = Date.parse(lastVisitedAt);
  return Number.isNaN(completedAt) || Number.isNaN(visitedAt) || completedAt > visitedAt;
}

const COUNT_ORDER = ["working", "approval", "input", "failed"] as const;

/** A computer's counts as the sidebar's run count badge shows them, in the thread rows' colours. */
export function computerRunCountGroups(counts: ComputerRunCounts): ReadonlyArray<RunCountGroup> {
  return COUNT_ORDER.flatMap((kind) =>
    counts[kind] > 0
      ? [
          {
            label: THREAD_STATUS_LABELS[kind].label,
            count: counts[kind],
            className: THREAD_STATUS_LABELS[kind].className,
          },
        ]
      : [],
  );
}

/**
 * The computer a shortcut picks: Ctrl+1 to Ctrl+9 the computers in the
 * section's order, Ctrl+0 All computers. On Windows and Linux, Ctrl+digit is the thread
 * jump and the browser's tab switch, so there it is Ctrl+Alt+digit.
 */
export function computerShortcutChoice(
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
  },
  computerIds: ReadonlyArray<EnvironmentId>,
  isMac: boolean,
): ComputerChoice | null {
  if (!event.ctrlKey || event.metaKey || event.shiftKey || event.altKey !== !isMac) return null;
  if (!/^[0-9]$/.test(event.key)) return null;
  const digit = Number(event.key);
  if (digit === 0) return "all";
  return computerIds[digit - 1] ?? null;
}

/** The shortcut's label for a row: index 0 is All computers. */
export function computerShortcutLabel(index: number, isMac: boolean): string | null {
  if (index > 9) return null;
  return isMac ? `⌃${index}` : `Ctrl+Alt+${index}`;
}
