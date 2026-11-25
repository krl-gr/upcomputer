/**
 * The session marker behind `app.unclean_exit`: written at start, removed at a
 * clean stop, so a start that finds it knows the previous one did not stop.
 */
import { DESKTOP_SESSION_STATE_FILE, DesktopSessionState } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { RecordOptions } from "./AnalyticsService.ts";

const SESSION_MARKER_FILE = "telemetry-session";
// A process that keeps dying would send its start-up events every few seconds.
// After this many unclean starts within the window, a start records nothing
// until it has stayed up for the quiet period, which a crash loop never does.
const CRASH_LOOP_WINDOW_MS = 60 * 60 * 1000;
const CRASH_LOOP_UNCLEAN_STARTS = 10;
const CRASH_LOOP_QUIET_MS = 10 * 60 * 1000;

const SessionMarker = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  startedAtMs: Schema.optionalKey(Schema.Number),
  // The event id of this session's unclean exit, so every report of it is the same event.
  reportId: Schema.optionalKey(Schema.String),
  uncleanStarts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  windowStartedAtMs: Schema.Number,
});
type SessionMarker = typeof SessionMarker.Type;
const decodeSessionMarker = Schema.decodeUnknownOption(Schema.fromJsonString(SessionMarker));
const encodeSessionMarker = Schema.encodeSync(Schema.fromJsonString(SessionMarker));
const decodeDesktopSessionState = Schema.decodeUnknownOption(
  Schema.fromJsonString(DesktopSessionState),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only versions a build writes, so a hand-edited marker cannot put text into an event.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,40})?$/;

// On Windows, antivirus and indexers can hold the marker open for a moment.
const MARKER_RETRY = { times: 3, schedule: Schedule.exponential("25 millis") };
// Errno codes a failed marker write or remove reports; never a path or message.
const MARKER_ERROR_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "EEXIST",
  "ENOSPC",
  "EROFS",
  "EIO",
  "EMFILE",
  "ENFILE",
  "EAGAIN",
  "UNKNOWN",
]);

function markerErrorCode(error: PlatformError.PlatformError): string {
  const cause = error.reason.cause;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
  return typeof code === "string" && MARKER_ERROR_CODES.has(code) ? code : "other";
}

/** The errno code of a marker operation that kept failing, or undefined. */
const tryMarkerOperation = (operation: Effect.Effect<void, PlatformError.PlatformError>) =>
  operation.pipe(
    Effect.retry(MARKER_RETRY),
    Effect.match({ onSuccess: () => undefined, onFailure: markerErrorCode }),
  );

type UncleanExitReason =
  | "os_shutdown"
  | "suspended"
  | "renderer_gone"
  | "backend_exited"
  | "unknown";

/**
 * What the desktop app last saw in the session that left the marker. It counts
 * only for that session and from after the marker's backend started, since a
 * restarted backend shares its app session with the one that died.
 */
function explainUncleanExit(
  marker: SessionMarker | undefined,
  desktop: DesktopSessionState | undefined,
): { readonly reason: UncleanExitReason } & Readonly<Record<string, string | number>> {
  if (
    marker?.sessionId === undefined ||
    desktop === undefined ||
    desktop.sessionId !== marker.sessionId ||
    (marker.startedAtMs !== undefined && desktop.atMs < marker.startedAtMs)
  ) {
    return { reason: "unknown" };
  }
  const last = desktop.last;
  switch (last.state) {
    case "os_shutdown":
    case "suspended":
      return { reason: last.state };
    case "renderer_gone":
      return { reason: "renderer_gone", rendererReason: last.reason, exitCode: last.exitCode };
    case "backend_exited":
      return {
        reason: "backend_exited",
        ...(last.code === null ? {} : { exitCode: last.code }),
        ...(last.signal === null ? {} : { exitSignal: last.signal }),
      };
    case "running":
      return { reason: "unknown" };
  }
}

interface SessionStart {
  /** Until then the server records nothing, because it is crash looping. */
  readonly quietUntilMs: number;
  /** Why this start's marker could not be written. */
  readonly markerError: string | undefined;
  /** The previous start's unclean exit, if it had one. */
  readonly uncleanExit: Option.Option<{
    readonly properties: Readonly<Record<string, unknown>>;
    readonly options: RecordOptions;
  }>;
}

/** Reads what the previous start left behind and writes this start's marker. */
export const startSession = Effect.fn("UncleanExit.startSession")(function* (input: {
  readonly stateDir: string;
  readonly isDesktopBackend: boolean;
  readonly sessionId: string;
  readonly version: string;
  readonly startedAtMs: number;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const markerPath = path.join(input.stateDir, SESSION_MARKER_FILE);
  const previousStart = yield* fileSystem.readFileString(markerPath).pipe(
    Effect.map((text) => Option.some(decodeSessionMarker(text))),
    Effect.catchCause(() => Effect.succeedNone),
  );
  // An unreadable marker still means the previous start did not stop cleanly.
  const previous = Option.getOrUndefined(Option.flatten(previousStart));
  // Only the desktop app sees why its session ended; it keeps that next to the marker.
  const desktopState =
    Option.isSome(previousStart) && input.isDesktopBackend
      ? yield* fileSystem
          .readFileString(path.join(input.stateDir, DESKTOP_SESSION_STATE_FILE))
          .pipe(
            Effect.map((text) => Option.getOrUndefined(decodeDesktopSessionState(text))),
            Effect.orElseSucceed(() => undefined),
          )
      : undefined;
  const explanation = explainUncleanExit(previous, desktopState);

  const windowContinues =
    previous !== undefined && input.startedAtMs - previous.windowStartedAtMs < CRASH_LOOP_WINDOW_MS;
  // A session the OS ended is not part of a crash loop.
  const uncleanStarts =
    (windowContinues ? previous.uncleanStarts : 0) +
    (Option.isNone(previousStart) || explanation.reason === "os_shutdown" ? 0 : 1);
  const windowStartedAtMs = windowContinues ? previous.windowStartedAtMs : input.startedAtMs;

  const reportId = yield* random.uuidV4().pipe(Effect.option);
  const markerError = yield* tryMarkerOperation(
    fileSystem.writeFileString(
      markerPath,
      encodeSessionMarker({
        sessionId: input.sessionId,
        version: input.version,
        startedAtMs: input.startedAtMs,
        ...(Option.isSome(reportId) ? { reportId: reportId.value } : {}),
        uncleanStarts,
        windowStartedAtMs,
      }),
    ),
  );

  const previousStartedAtMs =
    previous?.startedAtMs !== undefined &&
    Number.isFinite(previous.startedAtMs) &&
    previous.startedAtMs >= 0 &&
    previous.startedAtMs <= input.startedAtMs
      ? previous.startedAtMs
      : undefined;
  return {
    quietUntilMs:
      uncleanStarts > CRASH_LOOP_UNCLEAN_STARTS ? input.startedAtMs + CRASH_LOOP_QUIET_MS : 0,
    markerError,
    uncleanExit: Option.isNone(previousStart)
      ? Option.none()
      : Option.some({
          // A desktop backend restart keeps the app's session, so the previous
          // session can be this one; compare the ids to tell a backend crash apart.
          properties: {
            ...(previous?.sessionId !== undefined && UUID_PATTERN.test(previous.sessionId)
              ? { previousSessionId: previous.sessionId }
              : {}),
            ...(previous?.version !== undefined && VERSION_PATTERN.test(previous.version)
              ? { previousVersion: previous.version }
              : {}),
            uncleanStarts,
            ...explanation,
          },
          // A marker that outlives its session, because it could not be replaced
          // or removed, is reported again with the same id and time, so PostHog keeps one.
          options: {
            ...(previous?.reportId === undefined ? {} : { uuid: previous.reportId }),
            ...(previousStartedAtMs === undefined ? {} : { capturedAtMs: previousStartedAtMs }),
          },
        }),
  } satisfies SessionStart;
});

/** Removes this start's marker at a clean stop; the errno code when it could not. */
export const endSession = Effect.fn("UncleanExit.endSession")(function* (stateDir: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* tryMarkerOperation(
    fileSystem.remove(path.join(stateDir, SESSION_MARKER_FILE), { force: true }),
  );
});
