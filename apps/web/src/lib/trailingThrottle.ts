// @effect-diagnostics globalTimers:off - a DOM-side throttle for layout reads, outside an Effect runtime.

/**
 * Runs `fn` at most once per `intervalMs`: the first call runs now, later ones within the
 * interval collapse into one trailing run, so the last state is always read.
 */
export function createTrailingThrottle(fn: () => void, intervalMs: number) {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const runNow = () => {
    timer = null;
    lastRunAt = performance.now();
    fn();
  };
  return {
    run() {
      if (timer !== null) return;
      const wait = lastRunAt + intervalMs - performance.now();
      if (wait <= 0) runNow();
      else timer = setTimeout(runNow, wait);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
