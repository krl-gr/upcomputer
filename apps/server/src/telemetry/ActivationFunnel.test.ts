import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ProviderDriverKind } from "@upcomputer/contracts";
import {
  classifyTelemetryError,
  providerDimensions,
  terminalDimensions,
} from "./ActivationFunnel.ts";
import { FIRST_LAUNCH_MARKER_FILE, recordDesktopLaunch } from "./FirstLaunch.ts";

it.layer(NodeServices.layer)("activation funnel telemetry", (it) => {
  it.effect("emits first launch once and ordinary launch on subsequent desktop launches", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "up-first-launch-" });
      const markerPath = path.join(stateDir, FIRST_LAUNCH_MARKER_FILE);
      const events: string[] = [];
      const record = (event: string) => Effect.sync(() => events.push(event)).pipe(Effect.asVoid);

      yield* recordDesktopLaunch({ markerPath, enabled: true, record });
      yield* recordDesktopLaunch({ markerPath, enabled: true, record });

      assert.deepEqual(events, ["app.first_launch", "app.launched", "app.launched"]);
      assert.isTrue(yield* fileSystem.exists(markerPath));
    }),
  );

  it.effect("does not persist opt-out and claims when enabled later", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "up-first-launch-off-",
      });
      const markerPath = path.join(stateDir, FIRST_LAUNCH_MARKER_FILE);

      const events: string[] = [];
      const record = (event: string) => Effect.sync(() => events.push(event)).pipe(Effect.asVoid);
      yield* recordDesktopLaunch({ markerPath, enabled: false, record });
      assert.deepEqual(events, []);
      assert.isFalse(yield* fileSystem.exists(markerPath));
      yield* recordDesktopLaunch({ markerPath, enabled: true, record });
      assert.deepEqual(events, ["app.first_launch", "app.launched"]);
    }),
  );

  it("builds bounded content-free turn properties", () => {
    const provider = ProviderDriverKind.make("codex");
    assert.deepEqual(providerDimensions({ provider, interactionMode: "ask" }), {
      schemaVersion: 1,
      provider: "codex",
      interactionMode: "ask",
    });
    assert.deepEqual(
      terminalDimensions({ provider, interactionMode: "ask", durationMs: 1_250.4 }),
      {
        schemaVersion: 1,
        provider: "codex",
        interactionMode: "ask",
        durationMs: 1_250,
        durationBucket: "1s-5s",
      },
    );
    assert.equal(classifyTelemetryError({ _tag: "ProviderAuthenticationError" }), "authentication");
    assert.equal(classifyTelemetryError(new Error("secret raw message")), "unknown");
  });
});
