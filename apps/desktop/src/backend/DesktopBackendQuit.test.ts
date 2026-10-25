// @effect-diagnostics nodeBuiltinImport:off - Spawns a real backend process and reads its marker file.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopBrowserHost from "../preview/DesktopBrowserHost.ts";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopWslEnvironment from "../wsl/DesktopWslEnvironment.ts";
import * as DesktopBackendManager from "./DesktopBackendManager.ts";

// The server's own desktop telemetry receiver under runMain. Its shutdown finalizer, where the
// real server records `server.stopped` and flushes telemetry, writes a marker file.
const backendEntry = NodeURL.fileURLToPath(
  new URL(
    "../../../server/src/resourceTelemetry/testing/DesktopShutdownRequest.fixture.ts",
    import.meta.url,
  ),
);

function makeQuitTestInstance(
  marker: string,
  platform: NodeJS.Platform | undefined,
  onOutput: (text: string) => Effect.Effect<void>,
) {
  const config: DesktopBackendManager.DesktopBackendStartConfig = {
    executablePath: process.execPath,
    args: [backendEntry],
    entryPath: backendEntry,
    cwd: NodePath.dirname(backendEntry),
    env: { T3_TEST_SHUTDOWN_MARKER: marker },
    extendEnv: true,
    bootstrap: {
      mode: "desktop",
      noBrowser: true,
      port: 3773,
      t3Home: NodePath.dirname(backendEntry),
      host: "127.0.0.1",
      desktopBootstrapToken: "token",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      desktopTelemetryFd: 4,
    },
    bootstrapDelivery: "fd3",
    httpBaseUrl: new URL("http://127.0.0.1:3773"),
    captureOutput: true,
    preflightFailure: Option.none(),
  };
  const decoder = new TextDecoder();
  const services = Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))),
      ),
    ),
    Layer.succeed(DesktopObservability.DesktopBackendOutputLogFactory, {
      forInstance: () =>
        Effect.succeed({
          beginSession: () => Effect.void,
          writeOutputChunk: (stream, chunk) =>
            stream === "stdout" ? onOutput(decoder.decode(chunk)) : Effect.void,
          persistFailureSnapshot: () => Effect.void,
          persistFailure: () => Effect.void,
          discardSession: Effect.void,
        }),
    } satisfies DesktopObservability.DesktopBackendOutputLogFactory["Service"]),
    Layer.succeed(DesktopTelemetryPublisher.DesktopTelemetryPublisher, {
      latest: Effect.succeedNone,
      changes: Stream.empty,
      // The app's sample stream never ends, so the telemetry pipe stays open.
      encoded: Stream.never,
      handleControlForSource: () => Effect.void,
      removeControlSource: () => Effect.void,
      publishUpdateReport: () => Effect.void,
      updateRequests: Stream.empty,
      updateCommits: Stream.empty,
      updateCancellations: Stream.empty,
    }),
    DesktopBrowserHost.layer,
    DesktopWslEnvironment.layerTest(),
  );
  return DesktopBackendManager.makeBackendInstance({
    id: DesktopBackendManager.PRIMARY_INSTANCE_ID,
    label: Effect.succeed("Local environment"),
    configResolve: Effect.succeed(config),
  }).pipe(
    Effect.provide(services),
    // This OS's own stop unless a test picks another.
    platform === undefined
      ? (effect) => effect
      : Effect.provideService(HostProcess.Platform, platform),
  );
}

/** Starts a real backend, stops it the way quit does, and reports whether its shutdown ran. */
const quitRunsBackendShutdown = (platform: NodeJS.Platform | undefined) =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-quit-"))),
        (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
      );
      const marker = NodePath.join(directory, "stopped");
      let output = "";
      const ready = yield* Deferred.make<void>();
      const instance = yield* makeQuitTestInstance(marker, platform, (text) => {
        output += text;
        return output.includes("ready\n") ? Deferred.succeed(ready, undefined) : Effect.void;
      });

      yield* instance.start;
      yield* Deferred.await(ready).pipe(Effect.timeout("15 seconds"));
      // The bound `stopAllPoolInstances` gives each backend on quit.
      yield* instance.stop({ timeout: Duration.seconds(5) });

      return NodeFS.existsSync(marker);
    }),
  );

describe("desktop quit", () => {
  // On Windows a child kill is TerminateProcess, which skips this finalizer.
  it.live(
    "lets a real backend process run its shutdown before quit returns",
    () =>
      quitRunsBackendShutdown(undefined).pipe(
        Effect.map((ran) => assert.isTrue(ran, "the backend's shutdown finalizer did not run")),
      ),
    30_000,
  );

  // Windows' stop, on every OS.
  it.live(
    "lets a real backend process shut down on request before quit kills it",
    () =>
      quitRunsBackendShutdown("win32").pipe(
        Effect.map((ran) => assert.isTrue(ran, "the backend's shutdown finalizer did not run")),
      ),
    30_000,
  );
});
