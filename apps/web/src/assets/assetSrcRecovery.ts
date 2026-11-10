import { useEffect, useRef, useState } from "react";

/** Signals that abort when the component unmounts, so a request it waits on stops with it. */
export function useUnmountSignal(): () => AbortSignal | undefined {
  const controller = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- aborts requests still running when the component unmounts
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  return () => controller.current?.signal;
}

/**
 * A signed URL can expire before its next re-mint, as across sleep. A failed load
 * re-mints once. Every mint signs a new URL, so the retry belongs to the source and
 * only a successful load earns the next. `sourceKey` separates sources shown in turn.
 */
export function useAssetSrcRecovery(
  src: string | null,
  remint: ((signal: AbortSignal | undefined) => Promise<string | null>) | undefined,
  sourceKey?: string,
) {
  const [retry, setRetry] = useState<{
    readonly sourceKey: string | undefined;
    readonly failed: string;
    readonly next: string | null;
  } | null>(null);
  // The source whose retry is spent; a successful load clears it.
  const [spent, setSpent] = useState<{ readonly sourceKey: string | undefined } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const unmountSignal = useUnmountSignal();
  const retrySpent = spent !== null && spent.sourceKey === sourceKey;
  const current =
    retry !== null && retry.sourceKey === sourceKey && retry.failed === src ? retry.next : src;

  const giveUp = (failed: string) => {
    setFailedSrc(failed);
    setRetry((value) => (value?.failed === failed ? { ...value, next: failed } : value));
  };
  const onError = (loadingSrc: string) => {
    if (remint === undefined || retrySpent) {
      setFailedSrc(loadingSrc);
      return;
    }
    setSpent({ sourceKey });
    setRetry({ sourceKey, failed: loadingSrc, next: null });
    void remint(unmountSignal()).then(
      (next) => {
        if (next === null || next === loadingSrc) return giveUp(loadingSrc);
        setRetry((value) => (value?.failed === loadingSrc ? { ...value, next } : value));
      },
      () => giveUp(loadingSrc),
    );
  };
  const onLoad = () => {
    if (retrySpent) setSpent(null);
  };

  return { src: current, failed: current !== null && failedSrc === current, onError, onLoad };
}
