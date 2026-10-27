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
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../config.ts";
import { getTelemetryIdentifier } from "./Identify.ts";
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
    batch: Schema.Array(Schema.Struct({ uuid: Schema.String, event: Schema.String })),
  }),
);

type SentBatchEvent = (typeof SentBatch.Type)["batch"][number];

const layerAcceptThenFailClient = (batches: Array<ReadonlyArray<SentBatchEvent>>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* Schema.decodeEffect(SentBatch)(
            new TextDecoder().decode(request.body.body),
          ).pipe(Effect.orDie);
          batches.push(body.batch);
        }
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause: "connection reset" }),
        });
      }),
    ),
  );

const SentEvents = Schema.fromJsonString(
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

/** One server run in desktop mode on a fixed state directory, until its scope closes. */
const runDesktopServer = (
  baseDir: string,
  events: Array<SentEvent>,
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

it("retryDelayMs doubles from 2s and stays under the 5 minute cap", () => {
  assert.equal(AnalyticsService.retryDelayMs(1, 0), 1_000);
  assert.equal(AnalyticsService.retryDelayMs(2, 0.999_999), 4_000);
  assert.equal(AnalyticsService.retryDelayMs(30, 0), 150_000);
  assert.equal(AnalyticsService.retryDelayMs(30, 0.999_999), 300_000);
});

it.layer(NodeServices.layer)("AnalyticsService test", (it) => {
  it.effect("a batch that keeps failing is retried with backoff, then dropped", () =>
    Effect.gen(function* () {
      const sent: Array<ReadonlyArray<SentBatchEvent>> = [];
      const layerRuntime = AnalyticsService.layer.pipe(
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
            layerAcceptThenFailClient(sent),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const analytics = yield* AnalyticsService.AnalyticsService;
        // With server.started these fill exactly one batch.
        for (let index = 0; index < 19; index += 1) {
          yield* analytics.record("test.retry", { index });
        }
        for (let second = 0; second < 600; second += 1) {
          yield* TestClock.adjust("1 second");
        }
      }).pipe(Effect.provide(layerRuntime));

      // The shutdown flush tries server.stopped once more on its own.
      const batches = sent.filter((batch) => batch.some((event) => event.event === "test.retry"));
      assert.equal(batches.length, 5);
      const uuids = batches.map((batch) => batch.map((event) => event.uuid).join(","));
      assert.equal(new Set(uuids).size, 1, "every retry carries the same uuids");
      assert.equal(new Set(batches[0]?.map((event) => event.uuid)).size, 20);
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
        const telemetryIdentifier = yield* getTelemetryIdentifier;
        assert.equal(telemetryIdentifier !== null, true);
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
      const events: Array<SentEvent> = [];

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
      const events: Array<SentEvent> = [];
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
      const events: Array<SentEvent> = [];

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
