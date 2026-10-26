// @effect-diagnostics nodeBuiltinImport:off - Writes the marker synchronously from a finalizer.
// A stand-in desktop backend: the server's desktop telemetry receiver under runMain, with the
// desktop's descriptor layout (bootstrap on fd 3, telemetry on fd 4). It prints "stopped" from
// its shutdown finalizer, and writes `T3_TEST_SHUTDOWN_MARKER` when set. The desktop's quit
// test spawns it too.
import * as NodeFS from "node:fs";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as DesktopTelemetryReceiver from "../DesktopTelemetryReceiver.ts";

Effect.gen(function* () {
  const base = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-shutdown-request-" })),
  );
  yield* Layer.build(
    DesktopTelemetryReceiver.layer.pipe(
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(Layer.succeed(ServerConfig.ServerConfig, { ...base, desktopTelemetryFd: 4 })),
    ),
  );
  // Stands in for the server's shutdown finalizers, such as `server.stopped`. The marker file
  // comes first: a parent that stopped reading stdout must still see that this ran.
  const marker = process.env.T3_TEST_SHUTDOWN_MARKER;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (marker !== undefined) NodeFS.writeFileSync(marker, "stopped\n");
    }).pipe(Effect.andThen(Console.log("stopped"))),
  );
  yield* Console.log("ready");
  return yield* Effect.never;
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
