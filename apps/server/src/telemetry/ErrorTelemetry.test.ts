import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import * as AnalyticsService from "./AnalyticsService.ts";
import * as ErrorTelemetry from "./ErrorTelemetry.ts";

const SentEvents = Schema.fromJsonString(
  Schema.Struct({
    batch: Schema.Array(
      Schema.Struct({
        event: Schema.String,
        timestamp: Schema.String,
        properties: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  }),
);
type SentEvent = (typeof SentEvents.Type)["batch"][number];
const decodeSentEvents = Schema.decodeEffect(SentEvents);

const layerAcceptClient = (events: Array<SentEvent>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeSentEvents(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          events.push(...body.batch);
        }
        return HttpClientResponse.fromWeb(request, new Response("{}"));
      }),
    ),
  );

/** One server start on a fixed state directory, until `use` ends. */
const runServer = <E>(
  baseDir: string,
  events: Array<SentEvent>,
  use: (telemetry: ErrorTelemetry.ErrorTelemetry["Service"]) => Effect.Effect<void, E>,
) =>
  Effect.flatMap(ErrorTelemetry.ErrorTelemetry, use).pipe(
    Effect.provide(
      ErrorTelemetry.layer.pipe(
        Layer.provideMerge(AnalyticsService.layer),
        Layer.provideMerge(ServerConfig.ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              T3CODE_TELEMETRY_ENABLED: true,
              T3CODE_POSTHOG_KEY: "phc_test_key",
              T3CODE_POSTHOG_HOST: "http://localhost",
            }),
          ),
        ),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Platform, "darwin"),
            Layer.succeed(HostProcess.Architecture, "arm64"),
            layerAcceptClient(events),
          ),
        ),
      ),
    ),
  );

const errorsOf = (events: ReadonlyArray<SentEvent>) =>
  events.filter((event) => event.event === "app.error").map((event) => event.properties);

function throwFrom(name: string): Error {
  const error = new TypeError(`secret text from /Users/alice/${name}`);
  error.stack = `TypeError: ${error.message}\n    at ${name} (/Users/alice/app/dist/bin.mjs:10:5)`;
  return error;
}

it.layer(NodeServices.layer)("ErrorTelemetry", (it) => {
  it.effect("records a client error once per stack hash, with no text", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-error-dedupe-" });
      const events: Array<SentEvent> = [];
      const report = { errorClass: "TypeError", stackHash: "0123456789abcdef" } as const;

      yield* runServer(baseDir, events, (telemetry) =>
        Effect.gen(function* () {
          yield* telemetry.reportError("web", { ...report, kind: "boundary" });
          yield* telemetry.reportError("web", { ...report, kind: "uncaught" });
          yield* telemetry.reportError("desktop", { ...report, kind: "uncaught" });
          yield* telemetry.reportError("web", {
            kind: "unhandled_rejection",
            errorClass: "other",
            module: "index-DkX9a2bc.js",
            stackHash: "fedcba9876543210",
          });
        }),
      );

      assert.deepEqual(
        errorsOf(events).map(({ where, kind, errorClass, stackHash, module }) => ({
          where,
          kind,
          errorClass,
          stackHash,
          module,
        })),
        [
          {
            where: "web",
            kind: "boundary",
            errorClass: "TypeError",
            stackHash: "0123456789abcdef",
            module: undefined,
          },
          {
            where: "desktop",
            kind: "uncaught",
            errorClass: "TypeError",
            stackHash: "0123456789abcdef",
            module: undefined,
          },
          {
            where: "web",
            kind: "unhandled_rejection",
            errorClass: "other",
            stackHash: "fedcba9876543210",
            module: "index-DkX9a2bc.js",
          },
        ],
      );
    }),
  );

  it.effect("caps how many errors one process sends", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-error-cap-" });
      const events: Array<SentEvent> = [];

      yield* runServer(baseDir, events, (telemetry) =>
        Effect.forEach(
          Array.from({ length: 80 }, (_, index) => index),
          (index) =>
            telemetry.reportError("web", {
              kind: "uncaught",
              errorClass: "Error",
              stackHash: index.toString(16).padStart(16, "0"),
            }),
          { discard: true },
        ),
      );

      assert.equal(errorsOf(events).length, 50);
    }),
  );

  it.effect("sends a server crash on the next start, under the crashed session", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-error-crash-" });
      const events: Array<SentEvent> = [];

      // The listener runs as Node is about to exit, so nothing is sent then.
      yield* runServer(baseDir, events, () =>
        Effect.sync(() => {
          for (const listener of process.listeners("uncaughtExceptionMonitor")) {
            listener(throwFrom("startTurn"), "uncaughtException");
            listener(throwFrom("readProject"), "unhandledRejection");
          }
        }),
      );
      const crashedRun = events.splice(0);
      assert.deepEqual(errorsOf(crashedRun), []);
      const crashedSessionId = crashedRun[0]?.properties.sessionId;
      const pending = yield* fileSystem.readFileString(
        path.join(baseDir, "userdata", "telemetry-pending-errors"),
      );
      assert.notInclude(pending, "secret");
      assert.notInclude(pending, "alice");

      yield* runServer(baseDir, events, () => Effect.void);
      const errors = errorsOf(events);
      assert.deepEqual(
        errors.map(({ where, kind, errorClass, module, sessionId }) => ({
          where,
          kind,
          errorClass,
          module,
          sameSession: sessionId === crashedSessionId,
        })),
        [
          {
            where: "server",
            kind: "uncaught",
            errorClass: "TypeError",
            module: "bin.mjs",
            sameSession: true,
          },
          {
            where: "server",
            kind: "unhandled_rejection",
            errorClass: "TypeError",
            module: "bin.mjs",
            sameSession: true,
          },
        ],
      );
      assert.notEqual(
        events.find((event) => event.event === "server.started")?.properties.sessionId,
        crashedSessionId,
      );
      assert.isFalse(JSON.stringify(events).includes("secret"));

      // Sent once: the next start finds nothing pending.
      events.splice(0);
      yield* runServer(baseDir, events, () => Effect.void);
      assert.deepEqual(errorsOf(events), []);
    }),
  );

  it.effect("records a defect that ends the server", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-error-defect-" });
      const events: Array<SentEvent> = [];

      const exit = yield* Effect.exit(
        runServer(baseDir, events, () => Effect.die(throwFrom("bootProviders"))),
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.deepEqual(
        errorsOf(events).map(({ where, kind, errorClass }) => ({ where, kind, errorClass })),
        [{ where: "server", kind: "defect", errorClass: "TypeError" }],
      );
      assert.equal(events.at(-1)?.event, "server.stopped");
    }),
  );

  it.effect("records the desktop app's crash events", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-error-desktop-" });
      const events: Array<SentEvent> = [];

      yield* runServer(baseDir, events, (telemetry) =>
        Effect.gen(function* () {
          yield* telemetry.reportDesktopEvent({
            event: "desktop.backend.exited",
            instance: "primary",
            code: null,
            signal: "SIGKILL",
            uptimeMs: 12_000,
            wasReady: true,
            restarted: true,
          });
          yield* telemetry.reportDesktopEvent({
            event: "desktop.renderer.gone",
            reason: "crashed",
            surface: "main",
            exitCode: 11,
          });
          yield* telemetry.reportDesktopEvent({
            event: "app.error",
            kind: "uncaught",
            errorClass: "Error",
            module: "main.cjs",
            stackHash: "00000000000000aa",
          });
        }),
      );

      const crashes = events.filter(
        (event) => event.event !== "server.started" && event.event !== "server.stopped",
      );
      assert.deepEqual(
        crashes.map((event) => event.event),
        ["desktop.backend.exited", "desktop.renderer.gone", "app.error"],
      );
      assert.deepEqual(crashes[0]?.properties.signal, "SIGKILL");
      assert.deepEqual(crashes[1]?.properties.surface, "main");
      assert.deepEqual(crashes[2]?.properties.where, "desktop");
    }),
  );
});
