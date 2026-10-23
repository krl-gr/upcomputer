import { useEffect, useState } from "react";

/**
 * Saves a settings form as it changes. One save runs at a time; a change made
 * meanwhile saves after it. A value equal to the last saved one sends nothing,
 * and a failed save is retried with the next change.
 */
export function createAutosave<T>(initial: T | null, initialWrite: (value: T) => Promise<void>) {
  const keyOf = (value: T) => JSON.stringify(value);
  let saved = initial === null ? null : keyOf(initial);
  let latest = initial;
  let write = initialWrite;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();
  const run = async (): Promise<void> => {
    timer = undefined;
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    const value = latest;
    if (value === null || keyOf(value) === saved) return;
    running = true;
    try {
      const writing = write(value);
      inFlight = writing.then(
        () => undefined,
        () => undefined,
      );
      await writing;
      saved = keyOf(value);
    } catch {
      // `write` reports the failure; the next change tries again.
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      await run();
    }
  };
  return {
    /** The current form, or null while it is invalid. */
    update(value: T | null, nextWrite: (value: T) => Promise<void>) {
      latest = value;
      write = nextWrite;
    },
    schedule(delayMs: number) {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    /** Saves a scheduled change now, such as when the form closes. */
    flush() {
      if (timer === undefined) return Promise.resolve();
      clearTimeout(timer);
      return run();
    },
    /** Sends nothing more; resolves once a save already sent has settled. */
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      return inFlight;
    },
    resume() {
      stopped = false;
    },
  };
}

export function useAutosave<T>(value: T | null, write: (value: T) => Promise<void>) {
  const [autosave] = useState(() => createAutosave(value, write));
  // Runs before the caller's scheduling effects, so a scheduled save sees this render's form.
  useEffect(() => autosave.update(value, write));
  useEffect(
    () => () => {
      void autosave.flush();
    },
    [autosave],
  );
  return autosave;
}
