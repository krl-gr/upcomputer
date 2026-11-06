import { useLayoutEffect, useRef, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/**
 * Keys of tasks that showed up while the list was open, whoever created them. The first ready
 * list of a scope (the page filters) is the baseline, so opening the list or changing filters
 * marks nothing.
 */
export function useTaskArrivals(keys: ReadonlyArray<string>, scope: string, ready: boolean) {
  const seen = useRef<{ scope: string; keys: Set<string> } | null>(null);
  const [arrivals, setArrivals] = useState(NONE);
  const signature = keys.join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Compares the rows with the ones the list already painted; a layout effect marks an arrival before its first paint.
  useLayoutEffect(() => {
    if (!ready) return;
    const keys = signature === "" ? [] : signature.split("\n");
    const current = seen.current;
    if (current === null || current.scope !== scope) {
      seen.current = { scope, keys: new Set(keys) };
      setArrivals(NONE);
      return;
    }
    const fresh = keys.filter((key) => !current.keys.has(key));
    if (fresh.length === 0) return;
    for (const key of fresh) current.keys.add(key);
    setArrivals((previous) => new Set([...previous, ...fresh]));
  }, [signature, scope, ready]);
  return arrivals;
}
