import {
  DESKTOP_BACKEND_EXIT_SIGNALS,
  DesktopProductEventMessage,
  type DesktopBackendExitSignal,
  type DesktopProductEvent,
} from "@t3tools/contracts";
import { fingerprintError } from "@t3tools/shared/errorFingerprint";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

// The app session's crash events wait here while no backend is running, as
// after the backend itself died. A crash loop fills it; the oldest go first.
const QUEUE_CAPACITY = 32;
// Per app session and event type. The backend applies its own limits on top.
const MAX_EVENTS_PER_TYPE = 20;

const encodeMessage = Schema.encodeSync(Schema.fromJsonString(DesktopProductEventMessage));
const textEncoder = new TextEncoder();
const KNOWN_SIGNALS: ReadonlySet<string> = new Set(DESKTOP_BACKEND_EXIT_SIGNALS);
// Effect's child process reports a signal death only in this message; the
// backend manager turns it into a "killed by SIG..." exit reason.
const SIGNAL_IN_MESSAGE = /(?:receipt of signal: '|^killed by )(SIG[A-Z0-9]+)/;

/** The signal a backend died from, found in the exit status error's causes. */
export function backendExitSignal(error: unknown): DesktopBackendExitSignal | null {
  let current = error;
  for (let depth = 0; depth < 6 && typeof current === "object" && current !== null; depth++) {
    const { message, cause, reason } = current as {
      readonly message?: unknown;
      readonly cause?: unknown;
      readonly reason?: unknown;
    };
    const signal = typeof message === "string" ? SIGNAL_IN_MESSAGE.exec(message)?.[1] : undefined;
    if (signal !== undefined) {
      return KNOWN_SIGNALS.has(signal) ? (signal as DesktopBackendExitSignal) : "other";
    }
    current = cause ?? reason;
  }
  return null;
}

/**
 * Product events from the desktop app's main process. They go to the primary
 * backend over its telemetry pipe, so they share the install's identity and
 * opt-out with its own events.
 */
export class DesktopProductEvents extends Context.Service<
  DesktopProductEvents,
  {
    readonly record: (event: DesktopProductEvent) => Effect.Effect<void>;
    readonly encoded: Stream.Stream<Uint8Array>;
  }
>()("@t3tools/desktop/telemetry/DesktopProductEvents") {}

/** @public */
export const make = Effect.gen(function* () {
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const queue = yield* Queue.sliding<DesktopProductEvent>(QUEUE_CAPACITY);
  const counts = new Map<string, number>();
  const seenErrors = new Set<string>();

  const recordUnsafe = (event: DesktopProductEvent) => {
    if (event.event === "app.error") {
      if (seenErrors.has(event.stackHash)) return;
      seenErrors.add(event.stackHash);
    }
    const count = counts.get(event.event) ?? 0;
    if (count >= MAX_EVENTS_PER_TYPE) return;
    counts.set(event.event, count + 1);
    Queue.offerUnsafe(queue, event);
  };

  // Electron keeps the main process running after an uncaught error and shows
  // a dialog; a monitor sees the error without changing that.
  const onUncaught = (error: unknown) =>
    recordUnsafe({ event: "app.error", kind: "uncaught", ...fingerprintError(error) });
  // Electron's main process only warns about an unhandled rejection, and a
  // listener replaces that warning, so it logs one itself.
  const onRejection = (reason: unknown) => {
    runFork(Effect.logWarning("Unhandled promise rejection in the main process", { reason }));
    recordUnsafe({ event: "app.error", kind: "unhandled_rejection", ...fingerprintError(reason) });
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.on("uncaughtExceptionMonitor", onUncaught);
      process.on("unhandledRejection", onRejection);
    }),
    () =>
      Effect.sync(() => {
        process.off("uncaughtExceptionMonitor", onUncaught);
        process.off("unhandledRejection", onRejection);
      }),
  );

  return DesktopProductEvents.of({
    record: Effect.fn("DesktopProductEvents.record")(function* (event) {
      return yield* Effect.sync(() => recordUnsafe(event));
    }),
    encoded: Stream.fromQueue(queue).pipe(
      Stream.map((event) =>
        textEncoder.encode(
          `${encodeMessage({ version: 1, type: "desktopProductEvent", event })}\n`,
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(DesktopProductEvents, make);

const disabled = DesktopProductEvents.of({
  record: Effect.fn("DesktopProductEvents.record")(function* () {
    return yield* Effect.void;
  }),
  encoded: Stream.empty,
});

/**
 * The service where the app provides it. Tests and tools that build a backend
 * or a renderer registry on their own record nothing.
 */
export const optional = Effect.serviceOption(DesktopProductEvents).pipe(
  Effect.map((service) => (service._tag === "Some" ? service.value : disabled)),
);
