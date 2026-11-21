import { useCallback, useLayoutEffect, useRef, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/** A row of the list, and the group it shows in ("" for a list without groups). */
export interface ArrivalRow {
  readonly key: string;
  readonly group: string;
}

/** The rows a list scope has shown, and which of its groups were open with their rows loaded. */
export interface ArrivalBaseline {
  readonly scope: string;
  readonly keys: ReadonlySet<string>;
  readonly loadingMore: boolean;
  readonly readyGroups: ReadonlySet<string>;
}

/**
 * The first ready list of a scope is the baseline, so opening the list or changing filters
 * marks nothing. A new row is an arrival only in a group that was already open and loaded
 * before it came: rows that come with opening a group, or with a page it requested, are
 * old tasks. Rows that land with a requested page of the whole list are old tasks too.
 */
export function nextArrivals(
  baseline: ArrivalBaseline | null,
  rows: ReadonlyArray<ArrivalRow>,
  scope: string,
  loadingMore: boolean,
  readyGroups: ReadonlySet<string>,
): { readonly baseline: ArrivalBaseline; readonly arrived: ReadonlyArray<string> } {
  if (baseline === null || baseline.scope !== scope)
    return {
      baseline: { scope, keys: new Set(rows.map((row) => row.key)), loadingMore, readyGroups },
      arrived: [],
    };
  const fresh = rows.filter((row) => !baseline.keys.has(row.key));
  return {
    baseline: {
      scope,
      keys:
        fresh.length === 0
          ? baseline.keys
          : new Set([...baseline.keys, ...fresh.map((row) => row.key)]),
      loadingMore,
      readyGroups,
    },
    arrived:
      loadingMore || baseline.loadingMore
        ? []
        : fresh
            .filter((row) => readyGroups.has(row.group) && baseline.readyGroups.has(row.group))
            .map((row) => row.key),
  };
}

/**
 * Keys of tasks that showed up while the list was open, whoever created them. `settle` drops
 * keys once their animation ends, or when their group closes, so a row that shows again
 * later (reorder, another layout, a group opened again) stays still.
 */
export function useTaskArrivals(
  rows: ReadonlyArray<ArrivalRow>,
  scope: string,
  ready: boolean,
  loadingMore: boolean,
  readyGroups: ReadonlySet<string>,
) {
  const baseline = useRef<ArrivalBaseline | null>(null);
  const [arrivals, setArrivals] = useState(NONE);
  const signature = rows.map((row) => `${row.group}\t${row.key}`).join("\n");
  const groupsSignature = [...readyGroups].join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Compares the rows with the ones the list already painted; a layout effect marks an arrival before its first paint.
  useLayoutEffect(() => {
    if (!ready) return;
    const previous = baseline.current;
    const next = nextArrivals(
      previous,
      signature === ""
        ? []
        : signature.split("\n").map((line) => {
            const [group = "", key = ""] = line.split("\t");
            return { key, group };
          }),
      scope,
      loadingMore,
      new Set(groupsSignature === "" ? [] : groupsSignature.split("\n")),
    );
    baseline.current = next.baseline;
    if (previous?.scope !== scope) setArrivals(NONE);
    else if (next.arrived.length > 0)
      setArrivals((current) => new Set([...current, ...next.arrived]));
  }, [signature, groupsSignature, scope, ready, loadingMore]);
  const settle = useCallback((keys: ReadonlyArray<string>) => {
    setArrivals((current) => {
      if (!keys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, []);
  return { arrivals, settle };
}
