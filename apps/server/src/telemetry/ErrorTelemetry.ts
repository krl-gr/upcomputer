/**
 * `app.error` and the desktop app's crash events. Errors are reduced to a
 * whitelisted class, a file name and a stack hash before they leave the
 * process that saw them; no message or stack text is ever recorded.
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off - A process that is dying runs no more fibers; the crash is written synchronously.
import * as NodeFS from "node:fs";

import {
  AppErrorReport,
  AppErrorWhere,
  type DesktopProductEvent,
  type AppErrorReport as AppErrorReportValue,
} from "@t3tools/contracts";
import { fingerprintError } from "@t3tools/shared/errorFingerprint";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { AnalyticsService } from "./AnalyticsService.ts";

// A crash written by the process that died, sent by the next start.
const PENDING_ERRORS_FILE = "telemetry-pending-errors";
const MAX_PENDING_ERRORS = 5;
// Per server process and budget. Repeats of one error are dropped before
// they count, so this only bounds many different errors.
const MAX_EVENTS_PER_PROCESS = 50;
// Connected clients get their own budget: a misbehaving browser tab must not
// use up the one the server and desktop app report their crashes from.
const budgetOf = (where: typeof AppErrorWhere.Type) => (where === "web" ? "client" : "host");

const PendingError = Schema.Struct({
  ...AppErrorReport.fields,
  where: AppErrorWhere,
  sessionId: Schema.optionalKey(Schema.String),
  capturedAtMs: Schema.Number,
});
const decodePendingError = Schema.decodeUnknownOption(Schema.fromJsonString(PendingError));
const encodePendingError = Schema.encodeSync(Schema.fromJsonString(PendingError));

export class ErrorTelemetry extends Context.Service<
  ErrorTelemetry,
  {
    readonly reportError: (
      where: typeof AppErrorWhere.Type,
      report: AppErrorReportValue,
    ) => Effect.Effect<void>;
    /** A defect that reached a fiber's top: a request handler's or the server's own. */
    readonly reportDefect: (defect: unknown) => Effect.Effect<void>;
    readonly reportDesktopEvent: (event: DesktopProductEvent) => Effect.Effect<void>;
  }
>()("t3/telemetry/ErrorTelemetry") {
  static readonly layerTest = Layer.succeed(
    ErrorTelemetry,
    ErrorTelemetry.of({
      reportError: () => Effect.void,
      reportDefect: () => Effect.void,
      reportDesktopEvent: () => Effect.void,
    }),
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clock = yield* Clock.Clock;
  const pendingErrorsPath = path.join(config.stateDir, PENDING_ERRORS_FILE);
  const budget = yield* Ref.make({
    seen: new Set<string>(),
    recorded: new Map<ReturnType<typeof budgetOf>, number>(),
  });

  // Deduplicated per stack hash for this process's session: a render loop or a
  // retry loop repeats one error thousands of times.
  const admit = (where: typeof AppErrorWhere.Type, dedupeKey: string | undefined) =>
    Ref.modify(budget, (current) => {
      const key = budgetOf(where);
      const recorded = current.recorded.get(key) ?? 0;
      if (recorded >= MAX_EVENTS_PER_PROCESS) return [false, current] as const;
      if (dedupeKey !== undefined && current.seen.has(dedupeKey)) return [false, current] as const;
      const seen = dedupeKey === undefined ? current.seen : new Set(current.seen).add(dedupeKey);
      return [true, { seen, recorded: new Map(current.recorded).set(key, recorded + 1) }] as const;
    });

  const recordError = (
    where: typeof AppErrorWhere.Type,
    report: AppErrorReportValue,
    options?: { readonly sessionId?: string; readonly capturedAtMs?: number },
  ) =>
    admit(where, `${where}:${report.stackHash}`).pipe(
      Effect.flatMap((admitted) =>
        admitted ? analytics.record("app.error", { where, ...report }, options) : Effect.void,
      ),
    );

  const reportError: ErrorTelemetry["Service"]["reportError"] = (where, report) =>
    recordError(where, report);

  const reportDefect: ErrorTelemetry["Service"]["reportDefect"] = (defect) =>
    reportError("server", { kind: "defect", ...fingerprintError(defect) });

  const reportDesktopEvent: ErrorTelemetry["Service"]["reportDesktopEvent"] = (message) => {
    if (message.event === "app.error") {
      const { event: _event, ...report } = message;
      return reportError("desktop", report);
    }
    const { event, ...properties } = message;
    return admit("desktop", undefined).pipe(
      Effect.flatMap((admitted) => (admitted ? analytics.record(event, properties) : Effect.void)),
    );
  };

  if (analytics.enabled) {
    // The crashes the previous process wrote while it died.
    const pending = yield* fileSystem.readFileString(pendingErrorsPath).pipe(
      Effect.tap(() => fileSystem.remove(pendingErrorsPath, { force: true })),
      Effect.catchCause(() => Effect.succeed("")),
    );
    for (const line of pending.split("\n").slice(0, MAX_PENDING_ERRORS)) {
      const decoded = decodePendingError(line);
      if (decoded._tag === "None") continue;
      const { where, sessionId, capturedAtMs, ...report } = decoded.value;
      yield* recordError(where, report, {
        ...(sessionId === undefined ? {} : { sessionId }),
        capturedAtMs,
      });
    }

    // A monitor observes the crash without changing what Node does about it:
    // the process still dies, so the error is written down for the next start.
    const written = new Set<string>();
    const onFatalError = (error: unknown, origin: string) => {
      try {
        // A throwing getter on the error lands in the catch, not in Node.
        const fingerprint = fingerprintError(error);
        if (written.has(fingerprint.stackHash) || written.size >= MAX_PENDING_ERRORS) return;
        written.add(fingerprint.stackHash);
        NodeFS.appendFileSync(
          pendingErrorsPath,
          `${encodePendingError({
            where: "server",
            kind: origin === "unhandledRejection" ? "unhandled_rejection" : "uncaught",
            ...fingerprint,
            ...(analytics.sessionId === undefined ? {} : { sessionId: analytics.sessionId }),
            capturedAtMs: clock.currentTimeMillisUnsafe(),
          })}\n`,
        );
      } catch {
        // Telemetry must never turn one crash into another.
      }
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => process.on("uncaughtExceptionMonitor", onFatalError)),
      () => Effect.sync(() => process.off("uncaughtExceptionMonitor", onFatalError)),
    );

    // Runs before AnalyticsService's own finalizer, which flushes.
    yield* Effect.addFinalizer((exit) => {
      if (!Exit.isFailure(exit)) return Effect.void;
      const die = exit.cause.reasons.find(Cause.isDieReason);
      return die === undefined ? Effect.void : reportDefect(die.defect);
    });
  }

  return ErrorTelemetry.of({ reportError, reportDefect, reportDesktopEvent });
});

export const layer = Layer.effect(ErrorTelemetry, make);
