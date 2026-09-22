import type { DesktopEnvironmentBootstrap } from "@upcomputer/contracts";
import { useEffect, useState } from "react";

import { isWindowsPlatform } from "../lib/utils";
import { readDesktopSecondaryBootstrapsAsync } from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 2_000;

/**
 * Reactively track the desktop's secondary local backends (e.g. a parallel WSL
 * backend). The bridge exposes no change event, so we re-read on an interval;
 * failed reads retain the latest successful snapshot, while a successful empty
 * read clears it. Use this instead of polling the bridge ad hoc so every
 * renderer consumer reads the same topology.
 */
export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  const [bootstraps, setBootstraps] = useState<ReadonlyArray<DesktopEnvironmentBootstrap>>([]);

  useEffect(() => {
    // Secondary desktop backends are WSL-only. Avoid even scheduling topology
    // reads on macOS/Linux, where this list is permanently empty.
    if (!isWindowsPlatform(navigator.platform)) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      try {
        const next = await readDesktopSecondaryBootstrapsAsync();
        if (!cancelled) setBootstraps(next);
      } catch {
        // Preserve the last successful snapshot across transient IPC failures.
      } finally {
        // Schedule after completion so a busy main process cannot accumulate
        // overlapping IPC requests.
        if (!cancelled) timeout = setTimeout(read, DESKTOP_LOCAL_BOOTSTRAP_POLL_MS);
      }
    };

    void read();
    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, []);

  return bootstraps;
}
