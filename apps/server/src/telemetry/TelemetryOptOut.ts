import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

/**
 * The user's own "Share anonymous usage data" choice, kept as a marker in the
 * state directory, which updates keep.
 */
const TELEMETRY_OPT_OUT_FILE = "telemetry-opt-out";

// Relay tracing and the crash monitor ask synchronously, so the last value read or saved is kept.
const known = new Map<string, boolean>();

export const markerPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  return path.join(stateDir, TELEMETRY_OPT_OUT_FILE);
});

export const load = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const filePath = yield* markerPath;
  const optedOut = yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
  known.set(filePath, optedOut);
  return { filePath, optedOut };
}).pipe(Effect.withSpan("TelemetryOptOut.load"));

export const save = Effect.fn("TelemetryOptOut.save")(function* (optedOut: boolean) {
  const fileSystem = yield* FileSystem.FileSystem;
  const filePath = yield* markerPath;
  yield* optedOut
    ? fileSystem.writeFileString(filePath, "1\n")
    : fileSystem.remove(filePath, { force: true });
  known.set(filePath, optedOut);
});

/** What `load` or `save` last saw for this marker, for callers that cannot run an effect. */
export const isOptedOutUnsafe = (filePath: string) => known.get(filePath) === true;
