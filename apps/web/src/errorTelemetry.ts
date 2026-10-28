import type { AppErrorKind, ClientTelemetryEvent } from "@t3tools/contracts";
import { fingerprintError } from "@t3tools/shared/errorFingerprint";

type AppErrorEvent = Extract<ClientTelemetryEvent, { event: "app.error" }>;

// A render or retry loop repeats one error endlessly; each stack is sent once
// per page load, and a page sends a bounded number in total.
const MAX_ERRORS_PER_PAGE = 20;
// Errors from before the primary environment connects, such as a failed boot.
const MAX_QUEUED_ERRORS = 5;

export function createAppErrorReporter() {
  const seen = new Set<string>();
  let queued: AppErrorEvent[] = [];
  let send: ((event: AppErrorEvent) => void) | null = null;
  return {
    report(error: unknown, kind: AppErrorKind) {
      if (seen.size >= MAX_ERRORS_PER_PAGE) return;
      const event: AppErrorEvent = { event: "app.error", kind, ...fingerprintError(error) };
      if (seen.has(event.stackHash)) return;
      seen.add(event.stackHash);
      if (send !== null) send(event);
      else if (queued.length < MAX_QUEUED_ERRORS) queued.push(event);
    },
    setSender(next: ((event: AppErrorEvent) => void) | null) {
      send = next;
      if (next === null) return;
      const pending = queued;
      queued = [];
      for (const event of pending) next(event);
    },
  };
}

export const appErrorReporter = createAppErrorReporter();

/**
 * Reports errors nothing else handled. A script from another origin, such as
 * a browser extension on the hosted app, is not ours to report.
 */
export function installGlobalErrorTelemetry(
  target: EventTarget,
  options: {
    readonly origin: string;
    readonly reporter: Pick<ReturnType<typeof createAppErrorReporter>, "report">;
  },
): () => void {
  const onError = (event: Event) => {
    const { error, filename } = event as ErrorEvent;
    // A cross-origin script error arrives without the error.
    if (error === undefined || error === null) return;
    if (filename) {
      try {
        if (new URL(filename, options.origin).origin !== options.origin) return;
      } catch {
        return;
      }
    }
    options.reporter.report(error, "uncaught");
  };
  const onRejection = (event: Event) => {
    options.reporter.report((event as PromiseRejectionEvent).reason, "unhandled_rejection");
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
