import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as BackgroundNotices from "./BackgroundNotices.ts";

// Kept apart from the telemetry session marker, which opted-out installs never write.
const RUNNING_MARKER_FILE = "server-running.marker";

/**
 * A server that stops cleanly removes its marker. Finding one at a launch the
 * person made means the last run crashed or was force-quit, and agents it ran
 * were stopped. A desktop backend restart is not a launch, so it says nothing.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const markerPath = path.join(config.stateDir, RUNNING_MARKER_FILE);
    const startup = yield* Config.option(
      Config.Literals(["launch", "restart"], "T3CODE_DESKTOP_STARTUP"),
    ).pipe(Effect.orElseSucceed(() => Option.none()));
    const previousRunCrashed = yield* fileSystem
      .exists(markerPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (previousRunCrashed && Option.getOrUndefined(startup) !== "restart") {
      const notices = yield* Effect.serviceOption(BackgroundNotices.BackgroundNotices);
      if (Option.isSome(notices)) {
        yield* notices.value.report({
          id: "app:unclean-exit",
          area: "app",
          severity: "warning",
          title: "Up.computer closed unexpectedly",
          message:
            "Up.computer closed unexpectedly last time, so running agents were stopped. Open a thread and send a message to continue.",
        });
      }
    }
    yield* fileSystem.writeFileString(markerPath, "1\n").pipe(Effect.ignoreCause);
    yield* Effect.addFinalizer(() =>
      fileSystem.remove(markerPath, { force: true }).pipe(Effect.ignoreCause),
    );
  }),
);
