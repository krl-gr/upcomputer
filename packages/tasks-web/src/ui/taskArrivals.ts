import { useCallback, useLayoutEffect, useRef, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/** The rows a list scope has shown, and whether a requested page was still loading then. */
export interface ArrivalBaseline {
  readonly scope: string;
  readonly keys: ReadonlySet<string>;
  readonly loadingMore: boolean;
}

/**
 * The first ready list of a scope is the baseline, so opening the list or changing filters
 * marks nothing. Rows that land with a requested page (while it loads, or with the update
 * that ends it) are old tasks, not arrivals.
 */
export function nextArrivals(
  baseline: ArrivalBaseline | null,
  keys: ReadonlyArray<string>,
  scope: string,
  loadingMore: boolean,
): { readonly baseline: ArrivalBaseline; readonly arrived: ReadonlyArray<string> } {
  if (baseline === null || baseline.scope !== scope)
    return { baseline: { scope, keys: new Set(keys), loadingMore }, arrived: [] };
  const fresh = keys.filter((key) => !baseline.keys.has(key));
  return {
    baseline: {
      scope,
      keys: fresh.length === 0 ? baseline.keys : new Set([...baseline.keys, ...fresh]),
      loadingMore,
    },
    arrived: loadingMore || baseline.loadingMore ? [] : fresh,
  };
}

/**
 * Keys of tasks that showed up while the list was open, whoever created them. `settle` drops a
 * key once its animation ends, so a row that remounts later (reorder, another layout) stays still.
 */
export function useTaskArrivals(
  keys: ReadonlyArray<string>,
  scope: string,
  ready: boolean,
  loadingMore: boolean,
) {
  const baseline = useRef<ArrivalBaseline | null>(null);
  const [arrivals, setArrivals] = useState(NONE);
  const signature = keys.join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Compares the rows with the ones the list already painted; a layout effect marks an arrival before its first paint.
  useLayoutEffect(() => {
    if (!ready) return;
    const previous = baseline.current;
    const next = nextArrivals(
      previous,
      signature === "" ? [] : signature.split("\n"),
      scope,
      loadingMore,
    );
    baseline.current = next.baseline;
    if (previous?.scope !== scope) setArrivals(NONE);
    else if (next.arrived.length > 0)
      setArrivals((current) => new Set([...current, ...next.arrived]));
  }, [signature, scope, ready, loadingMore]);
  const settle = useCallback((key: string) => {
    setArrivals((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);
  return { arrivals, settle };
}
