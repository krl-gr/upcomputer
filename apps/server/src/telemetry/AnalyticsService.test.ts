import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../config.ts";
import { getTelemetryIdentity } from "./Identify.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

interface RecordedBatchRequest {
  readonly path: string;
  readonly body: {
    readonly batch?: ReadonlyArray<{
      readonly event?: string;
      readonly properties?: {
        readonly index?: number;
        readonly clientType?: string;
        readonly serverOs?: string;
        readonly serverArch?: string;
        readonly serverAppVersion?: string;
        readonly serverMode?: string;
        readonly t3CodeVersion?: string;
      };
    }>;
  } | null;
}

interface RecordedBatchBody {
  readonly batch: ReadonlyArray<{
    readonly event?: string;
    readonly properties?: {
      readonly index?: number;
      readonly clientType?: string;
      readonly serverOs?: string;
      readonly serverArch?: string;
      readonly serverAppVersion?: string;
      readonly serverMode?: string;
      readonly t3CodeVersion?: string;
    };
  }>;
}

const SentBatch = Schema.fromJsonString(
  Schema.Struct({
    batch: Schema.Array(
      Schema.Struct({
        uuid: Schema.String,
        event: Schema.String,
        distinct_id: Schema.String,
        properties: Schema.Struct({
          telemetryChannel: Schema.String,
          installId: Schema.optionalKey(Schema.String),
          ownerSource: Schema.optionalKey(Schema.String),
          observedBy: Schema.optionalKey(Schema.String),
        }),
      }),
    ),
  }),
);
const decodeSentBatch = Schema.decodeEffect(SentBatch);
type SentEvent = (typeof SentBatch.Type)["batch"][number];
type Respond = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>;

const respondWithStatus =
  (status: number): Respond =>
  (request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })));

// With server.started these fill exactly one batch of 20.
const recordTwentyEvents = Effect.gen(function* () {
  const analytics = yield* AnalyticsService.AnalyticsService;
  for (let index = 0; index < 19; index += 1) {
    yield* analytics.record("test.retry", { index });
  }
});

const LIFECYCLE_EVENTS = new Set(["server.started", "server.stopped"]);
// The server reports its own start and stop around every run.
const withoutLifecycle = (batches: ReadonlyArray<ReadonlyArray<SentEvent>>) =>
  batches.flat().filter((event) => !LIFECYCLE_EVENTS.has(event.event));

/**
 * Runs `record` (20 events by default, with server.started), then lets ten minutes of background
 * flushes run against a client that answers every send with `respond`.
 * Returns the sent batches.
 */
const sendForTenMinutes = (
  respond: Respond,
  record: Effect.Effect<
    void,
    never,
    AnalyticsService.AnalyticsService | Effect.Services<typeof getTelemetryIdentity>
  > = recordTwentyEvents,
) =>
  Effect.gen(function* () {
    const batches: Array<ReadonlyArray<SentEvent>> = [];
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeSentBatch(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          batches.push(body.batch);
        }
        return yield* respond(request);
      }),
    );
    const runtimeLayer = AnalyticsService.layer.pipe(
      Layer.provideMerge(
        ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-telemetry-retry-" }),
      ),
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
          Layer.succeed(HostProcess.Platform, "win32"),
          Layer.succeed(HostProcess.Architecture, "x64"),
          Layer.succeed(HttpClient.HttpClient, client),
        ),
      ),
    );

    yield* Effect.gen(function* () {
      yield* record;
      for (let second = 0; second < 600; second += 1) {
        yield* TestClock.adjust("1 second");
      }
    }).pipe(Effect.provide(runtimeLayer));
    return batches;
  });

const DesktopEvents = Schema.fromJsonString(
  Schema.Struct({
    batch: Schema.Array(
      Schema.Struct({
        event: Schema.String,
        distinct_id: Schema.String,
        properties: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  }),
);
type DesktopEvent = (typeof DesktopEvents.Type)["batch"][number];
const decodeDesktopEvents = Schema.decodeEffect(DesktopEvents);

const layerAcceptClient = (events: Array<DesktopEvent>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeDesktopEvents(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          events.push(...body.batch);
        }
        return HttpClientResponse.fromWeb(request, new Response("{}"));
      }),
    ),
  );

/** One server run in desktop mode on a fixed state directory, until its scope closes. */
const runDesktopServer = (
  baseDir: string,
  events: Array<DesktopEvent>,
  use: (analytics: AnalyticsService.AnalyticsService["Service"]) => Effect.Effect<void>,
  desktopEnv: Readonly<Record<string, string>> = {},
) =>
  Effect.flatMap(AnalyticsService.AnalyticsService, use).pipe(
    Effect.provide(
      AnalyticsService.layer.pipe(
        Layer.provide(
          Layer.effect(
            ServerConfig.ServerConfig,
            Effect.map(ServerConfig.ServerConfig, (config) =>
              ServerConfig.ServerConfig.of({ ...config, mode: "desktop" }),
            ),
          ).pipe(Layer.provide(ServerConfig.ServerConfig.layerTest(process.cwd(), baseDir))),
        ),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              T3CODE_TELEMETRY_ENABLED: true,
              T3CODE_POSTHOG_KEY: "phc_test_key",
              T3CODE_POSTHOG_HOST: "http://localhost",
              ...desktopEnv,
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

it.layer(NodeServices.layer)("AnalyticsService test", (it) => {
  it.effect("client owner reports cannot use up the server's owner cap", () =>
    Effect.gen(function* () {
      const batches = yield* sendForTenMinutes(
        respondWithStatus(204),
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          yield* analytics.recordOwners(
            Array.from({ length: 1_001 }, (_, index) => ({
              source: "device" as const,
              ownerId: index.toString(16).padStart(64, "0"),
            })),
            "client",
          );
          // The event buffer also holds 1,000, so send the client events first.
          yield* analytics.flush;
          yield* analytics.recordOwners([{ source: "connect", ownerId: "a".repeat(64) }], "server");
        }),
      );
      const owners = withoutLifecycle(batches).map((event) => event.properties.observedBy);

      assert.equal(owners.filter((observedBy) => observedBy === "client").length, 1_000);
      assert.equal(owners.filter((observedBy) => observedBy === "server").length, 1);
    }),
  );

  it.effect("flush drains all buffered events across multiple batches", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const layerServerConfig = ServerConfig.ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-base-",
      });

      const layerTelemetry = AnalyticsService.layer.pipe(Layer.provideMerge(layerServerConfig));
      const layerConfig = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "http://localhost",
          T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const layerBatchServer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "POST") {
            return HttpServerResponse.empty({ status: 404 });
          }

          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const layerRuntime = layerTelemetry.pipe(
        Layer.provide(layerConfig),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Platform, "linux"),
            Layer.succeed(HostProcess.Architecture, "arm64"),
          ),
        ),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(layerBatchServer).pipe(Effect.forkScoped);
        const { distinctId } = yield* getTelemetryIdentity;
        assert.equal(distinctId !== null, true);
        const analytics = yield* AnalyticsService.AnalyticsService;

        for (let index = 0; index < 45; index += 1) {
          yield* analytics.record("test.flush.drain", { index });
        }

        yield* analytics.flush;
      }).pipe(Effect.provide(layerRuntime));

      // The shutdown flush sends server.stopped on its own afterwards.
      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch) &&
          request.body.batch.some((event) => event.event === "test.flush.drain"),
      );
      assert.equal(batchRequests.length, 3);
      assert.equal(
        batchRequests.every(
          (request) => request.path.endsWith("/batch/") || request.path.endsWith("/batch"),
        ),
        true,
      );
      const deliveredIndexes = batchRequests.flatMap((request) =>
        request.body.batch
          .filter((event) => event.event === "test.flush.drain")
          .map((event) => event.properties?.index)
          .filter((index): index is number => typeof index === "number"),
      );

      const sorted = deliveredIndexes.toSorted((a, b) => a - b);
      assert.equal(sorted.length, 45);
      assert.deepEqual(
        sorted,
        Array.from({ length: 45 }, (_, index) => index),
      );
      assert.equal(
        batchRequests.every((request) =>
          request.body.batch.every((event) => event.properties?.clientType === "cli-web-client"),
        ),
        true,
      );
      assert.equal(
        batchRequests.every((request) =>
          request.body.batch.every(
            (event) =>
              event.properties?.serverOs === "Linux" &&
              event.properties.serverArch === "arm64" &&
              event.properties.serverAppVersion === event.properties.t3CodeVersion &&
              event.properties.serverMode === "web",
          ),
        ),
        true,
      );
    }),
  );

  it.effect("reports a desktop install's first launch, milestones and run length once", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-telemetry-first-launch-",
      });
      const events: Array<DesktopEvent> = [];

      yield* runDesktopServer(baseDir, events, (analytics) =>
        Effect.gen(function* () {
          yield* analytics.recordMilestone("app.first_thread_created");
          yield* analytics.recordMilestone("app.first_thread_created");
          yield* analytics.recordMilestone("app.first_task_created", { via: "agent" });
          yield* analytics.recordMilestone("app.first_task_created", { via: "app" });
          yield* TestClock.adjust("90 seconds");
        }),
      );
      const firstRun = events.splice(0);
      yield* runDesktopServer(baseDir, events, (analytics) =>
        analytics.recordMilestone("app.first_thread_created"),
      );

      assert.deepEqual(
        firstRun.map((event) => event.event),
        [
          "server.started",
          "app.first_launch",
          "app.first_thread_created",
          "app.first_task_created",
          "server.stopped",
        ],
      );
      assert.equal(firstRun[3]?.properties.via, "agent");
      assert.equal(firstRun.at(-1)?.properties.uptimeMs, 90_000);
      assert.equal(new Set(firstRun.map((event) => event.distinct_id)).size, 1);
      assert.deepEqual(
        events.map((event) => event.event),
        ["server.started", "server.stopped"],
      );
      assert.equal(events[0]?.distinct_id, firstRun[0]?.distinct_id);
    }),
  );

  it.effect("tells an app launch from a backend restart and tags the desktop build", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-telemetry-launch-",
      });
      const events: Array<DesktopEvent> = [];
      const desktop = {
        T3CODE_DESKTOP_VERSION: "0.0.35",
        T3CODE_DESKTOP_RELEASE_CHANNEL: "latest",
      };

      yield* runDesktopServer(baseDir, events, () => Effect.void, {
        ...desktop,
        T3CODE_DESKTOP_STARTUP: "launch",
      });
      const launch = events.splice(0);
      yield* runDesktopServer(baseDir, events, () => Effect.void, {
        ...desktop,
        T3CODE_DESKTOP_STARTUP: "restart",
      });

      assert.deepEqual(
        launch.map((event) => event.event),
        ["server.started", "app.first_launch", "app.launched", "server.stopped"],
      );
      assert.equal(launch[0]?.properties.startupContext, "launch");
      assert.isTrue(
        launch.every(
          (event) =>
            event.properties.desktopVersion === "0.0.35" &&
            event.properties.releaseChannel === "latest",
        ),
      );
      assert.deepEqual(
        events.map((event) => [event.event, event.properties.startupContext]),
        [
          ["server.started", "restart"],
          ["server.stopped", undefined],
        ],
      );
    }),
  );

  it.effect("tags events with the desktop build kind and one session per app launch", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-telemetry-session-",
      });
      const events: Array<SentEvent> = [];
      const desktop = {
        T3CODE_DESKTOP_BUILD_KIND: "localtest",
        T3CODE_DESKTOP_SESSION_ID: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      };

      yield* runDesktopServer(baseDir, events, () => Effect.void, {
        ...desktop,
        T3CODE_DESKTOP_STARTUP: "launch",
      });
      yield* runDesktopServer(baseDir, events, () => Effect.void, {
        ...desktop,
        T3CODE_DESKTOP_STARTUP: "restart",
      });
      assert.isTrue(
        events.every(
          (event) =>
            event.properties.buildKind === "localtest" &&
            event.properties.sessionId === desktop.T3CODE_DESKTOP_SESSION_ID &&
            event.properties.isInternal === false,
        ),
      );

      // Without the desktop app's values the server classifies itself and starts a session.
      const standalone: Array<SentEvent> = [];
      yield* runDesktopServer(baseDir, standalone, () => Effect.void);
      yield* runDesktopServer(baseDir, standalone, () => Effect.void, {
        T3CODE_DESKTOP_SESSION_ID: "not-a-uuid",
      });
      // Tests run the server from source, which is a dev build.
      assert.isTrue(standalone.every((event) => event.properties.buildKind === "dev"));
      const sessions = new Set(standalone.map((event) => event.properties.sessionId));
      assert.equal(sessions.size, 2);
      assert.isTrue(
        [...sessions].every(
          (id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id) && id !== "not-a-uuid",
        ),
      );
    }),
  );

  it.effect("marks events from an internal device while its marker file exists", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-telemetry-internal-",
      });
      const marker = path.join(baseDir, "userdata", "telemetry-internal-device");
      const events: Array<SentEvent> = [];

      yield* runDesktopServer(baseDir, events, (analytics) =>
        Effect.gen(function* () {
          assert.isFalse(yield* analytics.internalDevice);
          yield* analytics.record("before");
          yield* analytics.flush;
          assert.isTrue(yield* analytics.setInternalDevice(true).pipe(Effect.orDie));
          assert.isTrue(yield* fileSystem.exists(marker).pipe(Effect.orDie));
          yield* analytics.record("internal");
          yield* analytics.flush;
        }),
      );
      const firstRun = events.splice(0);
      // The marker outlives the server, as it does an app update.
      yield* runDesktopServer(baseDir, events, (analytics) =>
        Effect.gen(function* () {
          assert.isTrue(yield* analytics.internalDevice);
          assert.isFalse(yield* analytics.setInternalDevice(false).pipe(Effect.orDie));
          yield* analytics.record("after");
        }),
      );

      const isInternal = (sent: ReadonlyArray<SentEvent>, name: string) =>
        sent.find((event) => event.event === name)?.properties.isInternal;
      assert.equal(isInternal(firstRun, "before"), false);
      assert.equal(isInternal(firstRun, "internal"), true);
      assert.equal(isInternal(events, "server.started"), true);
      assert.equal(isInternal(events, "after"), false);
      assert.isFalse(yield* fileSystem.exists(marker));
    }),
  );

  it.effect("reports an unclean exit on the next start, with the session that crashed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-telemetry-unclean-",
      });
      const marker = path.join(baseDir, "userdata", "telemetry-session");
      const events: Array<SentEvent> = [];

      yield* runDesktopServer(baseDir, events, () =>
        Effect.gen(function* () {
          assert.isTrue(yield* fileSystem.exists(marker));
        }).pipe(Effect.orDie),
      );
      // A clean stop removes the marker, so the next start is not unclean.
      assert.isFalse(yield* fileSystem.exists(marker));
      yield* runDesktopServer(baseDir, events, () => Effect.void);
      assert.isFalse(events.some((event) => event.event === "app.unclean_exit"));

      // What a process that died leaves behind.
      const crashedSessionId = "1d2c3b4a-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
      yield* fileSystem.writeFileString(
        marker,
        JSON.stringify({
          sessionId: crashedSessionId,
          version: "0.0.36",
          uncleanStarts: 0,
          windowStartedAtMs: 0,
        }),
      );
      events.splice(0);
      yield* runDesktopServer(baseDir, events, () => Effect.void);
      const unclean = events.filter((event) => event.event === "app.unclean_exit");
      assert.deepEqual(
        unclean.map(({ properties: { previousSessionId, previousVersion, uncleanStarts } }) => ({
          previousSessionId,
          previousVersion,
          uncleanStarts,
        })),
        [{ previousSessionId: crashedSessionId, previousVersion: "0.0.36", uncleanStarts: 1 }],
      );
      assert.notEqual(unclean[0]?.properties.sessionId, crashedSessionId);

      // A marker that cannot be read still means the last start did not stop.
      yield* fileSystem.writeFileString(marker, "{not json");
      events.splice(0);
      yield* runDesktopServer(baseDir, events, () => Effect.void);
      assert.deepEqual(
        events
          .filter((event) => event.event === "app.unclean_exit")
          .map(({ properties: { previousSessionId, uncleanStarts } }) => ({
            previousSessionId,
            uncleanStarts,
          })),
        [{ previousSessionId: undefined, uncleanStarts: 1 }],
      );
    }),
  );

  it.effect("goes quiet while the server is crash looping", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-telemetry-loop-" });
      const marker = path.join(baseDir, "userdata", "telemetry-session");
      const events: Array<SentEvent> = [];
      const crash = (uncleanStarts: number) =>
        fileSystem.writeFileString(marker, JSON.stringify({ uncleanStarts, windowStartedAtMs: 0 }));

      yield* fileSystem.makeDirectory(path.dirname(marker), { recursive: true });
      // The tenth unclean start within the hour still reports.
      yield* crash(9);
      yield* runDesktopServer(baseDir, events, () => Effect.void);
      assert.deepEqual(
        events.find((event) => event.event === "app.unclean_exit")?.properties.uncleanStarts,
        10,
      );

      // The eleventh records nothing until it has stayed up for ten minutes.
      yield* crash(10);
      events.splice(0);
      yield* runDesktopServer(baseDir, events, (analytics) =>
        Effect.gen(function* () {
          yield* analytics.record("probe.early");
          yield* TestClock.adjust("10 minutes");
          yield* analytics.record("probe.late");
        }),
      );
      assert.deepEqual(
        events.map((event) => event.event),
        ["probe.late", "server.stopped"],
      );

      // An hour later the count starts over.
      yield* fileSystem.writeFileString(
        marker,
        JSON.stringify({ uncleanStarts: 40, windowStartedAtMs: -60 * 60 * 1000 }),
      );
      events.splice(0);
      yield* runDesktopServer(baseDir, events, () => Effect.void);
      assert.equal(
        events.find((event) => event.event === "app.unclean_exit")?.properties.uncleanStarts,
        1,
      );
    }),
  );

  it.effect("does not report milestones for an install first launched by an older build", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-telemetry-upgraded-",
      });
      yield* fileSystem.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(baseDir, "userdata", "telemetry-first-launch-v1"),
        "1\n",
      );
      const events: Array<DesktopEvent> = [];

      yield* runDesktopServer(baseDir, events, (analytics) =>
        analytics.recordMilestone("app.first_message_sent"),
      );

      assert.deepEqual(
        events.map((event) => event.event),
        ["server.started", "server.stopped"],
      );
    }),
  );

  it.effect("does not send batch requests when telemetry is disabled", () =>
    Effect.gen(function* () {
      const capturedPaths: Array<string> = [];
      const layerServerConfig = ServerConfig.ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-disabled-",
      });
      const layerTelemetry = AnalyticsService.layer.pipe(Layer.provideMerge(layerServerConfig));
      const layerConfig = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: false,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "http://localhost",
        }),
      );
      const layerBatchServer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          capturedPaths.push(request.url);
          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const layerRuntime = layerTelemetry.pipe(
        Layer.provide(layerConfig),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Platform, "linux"),
            Layer.succeed(HostProcess.Architecture, "arm64"),
          ),
        ),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(layerBatchServer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;
        yield* analytics.record("test.disabled", { index: 1 });
        yield* analytics.flush;
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        assert.isFalse(yield* fileSystem.exists(config.anonymousIdPath));
        assert.isFalse(yield* fileSystem.exists(`${config.stateDir}/telemetry-id`));
      }).pipe(Effect.provide(layerRuntime));

      assert.deepEqual(capturedPaths, []);
    }),
  );
});
