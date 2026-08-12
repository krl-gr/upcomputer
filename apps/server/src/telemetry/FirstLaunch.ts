import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { ActivationEvent, ACTIVATION_EVENT_SCHEMA_VERSION } from "./ActivationFunnel.ts";

export const FIRST_LAUNCH_MARKER_FILE = "telemetry-first-launch-v1";

/**
 * Claims the installation-scoped first-launch milestone.
 *
 * Disabled telemetry never reads or writes the marker. Consequently, an
 * installation first launched while opted out claims and emits its first
 * launch only after telemetry is enabled on a later desktop launch.
 */
export const claimFirstLaunch = Effect.fn("telemetry.claimFirstLaunch")(function* (
  markerPath: string,
  enabled: boolean,
) {
  if (!enabled) return false;

  const fileSystem = yield* FileSystem.FileSystem;
  const alreadyClaimed = yield* fileSystem
    .exists(markerPath)
    .pipe(Effect.orElseSucceed(() => false));
  if (alreadyClaimed) return false;

  yield* fileSystem.writeFileString(markerPath, "1\n");
  return true;
});

export const recordDesktopLaunch = Effect.fn("telemetry.recordDesktopLaunch")(function* (input: {
  readonly markerPath: string;
  readonly enabled: boolean;
  readonly record: (
    event: string,
    properties: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>;
}) {
  if (!input.enabled) return;

  const isFirstLaunch = yield* claimFirstLaunch(input.markerPath, true);
  if (isFirstLaunch) {
    yield* input.record(ActivationEvent.appFirstLaunch, {
      schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    });
  }
  yield* input.record(ActivationEvent.appLaunched, {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    startupContext: "desktop-launch",
  });
});
