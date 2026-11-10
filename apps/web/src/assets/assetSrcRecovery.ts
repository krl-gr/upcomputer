import { useState } from "react";

/**
 * A signed URL can expire or be refused before its next scheduled re-mint, as
 * after the computer sleeps. A failed load re-mints once and loads the new URL;
 * the source fails only when the re-mint or that load fails too. A later URL for
 * the same source gets its own re-mint, so retries follow the URL's refreshes.
 */
export function useAssetSrcRecovery(
  src: string | null,
  remint: (() => Promise<string | null>) | undefined,
) {
  const [retry, setRetry] = useState<{
    readonly failed: string;
    readonly next: string | null;
  } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const current = retry !== null && retry.failed === src ? retry.next : src;

  const giveUp = (failed: string) => {
    setFailedSrc(failed);
    setRetry((pending) => (pending?.failed === failed ? { failed, next: failed } : pending));
  };
  const onError = (loadingSrc: string) => {
    if (remint === undefined || loadingSrc !== src || retry?.failed === src) {
      setFailedSrc(loadingSrc);
      return;
    }
    setRetry({ failed: loadingSrc, next: null });
    void remint().then(
      (next) => {
        if (next === null || next === loadingSrc) return giveUp(loadingSrc);
        setRetry((pending) =>
          pending?.failed === loadingSrc ? { failed: loadingSrc, next } : pending,
        );
      },
      () => giveUp(loadingSrc),
    );
  };

  return { src: current, failed: current !== null && failedSrc === current, onError };
}
