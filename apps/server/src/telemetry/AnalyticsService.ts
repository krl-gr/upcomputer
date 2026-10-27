/**
 * Each event carries a uuid, so PostHog can tell a retried copy from a new
 * event.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  resolveUpcomputerBuildKind,
  type UpcomputerBuildKind,
} from "@t3tools/shared/upcomputerIdentity";
import type { ClientOs } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import { getTelemetryIdentifier } from "./Identify.ts";

interface BufferedAnalyticsEvent {
  readonly uuid: string;
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
  readonly isInternal: boolean;
  /** Set for an event that belongs to an earlier session, such as a crash it could not send. */
  readonly sessionId?: string;
}

export interface RecordOptions {
  readonly sessionId?: string;
  readonly capturedAtMs?: number;
}

interface DeliveryState {
  readonly failedBatch: ReadonlyArray<BufferedAnalyticsEvent>;
  readonly batchAttempts: number;
  readonly failures: number;
  readonly retryAt: number;
}

const FLUSH_INTERVAL_MS = 1_000;
// A hung send would hold the flush lock, and with it the shutdown flush.
const SEND_TIMEOUT = "10 seconds";
const MAX_BATCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 300_000;

/** `random` is in [0, 1). */
export function retryDelayMs(failures: number, random: number): number {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failures - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

const UPCOMPUTER_POSTHOG_PROJECT_KEY = "phc_uqRUAQavAKuUny7uFxm8tqr6nyVDpdoSARKsWNzs8wBx";

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.String("T3CODE_POSTHOG_KEY").pipe(
    // The Up.computer PostHog project, the same one V1 reported to.
    Config.withDefault(UPCOMPUTER_POSTHOG_PROJECT_KEY),
  ),
  posthogHost: Config.String("T3CODE_POSTHOG_HOST").pipe(
    Config.withDefault("https://us.i.posthog.com"),
  ),
  enabled: Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(true)),
  flushBatchSize: Config.Number("T3CODE_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.Number("T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
  wslDistroName: Config.String("WSL_DISTRO_NAME").pipe(Config.option),
  // Set by the desktop app for its primary backend.
  desktopVersion: Config.String("T3CODE_DESKTOP_VERSION").pipe(Config.option),
  releaseChannel: Config.String("T3CODE_DESKTOP_RELEASE_CHANNEL").pipe(Config.option),
  desktopStartup: Config.Literals(["launch", "restart"], "T3CODE_DESKTOP_STARTUP").pipe(
    Config.option,
  ),
  desktopBuildKind: Config.Literals(
    ["dev", "localtest", "rc", "nightly", "stable"],
    "T3CODE_DESKTOP_BUILD_KIND",
  ).pipe(Config.option),
  desktopSessionId: Config.String("T3CODE_DESKTOP_SESSION_ID").pipe(Config.option),
});

// Only bundles define it, so a server run from source is a dev build.
declare const __T3CODE_BUILD_CHANNEL__: string | undefined;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TelemetryMilestone =
  | "app.first_thread_created"
  | "app.first_message_sent"
  | "app.first_task_created"
  | "app.first_agent_created"
  | "app.first_agent_run"
  | "app.first_automation_created"
  | "app.first_scheduled_task_created"
  | "app.first_bot_chat";

// 0.0.32 wrote this marker, so installs upgraded from it never report a second first launch.
const FIRST_LAUNCH_MARKER_FILE = "telemetry-first-launch-v1";
// Marks a team or test device, so its events can be filtered out. It lives in the
// state dir, which app updates keep, and env vars do not reach Finder launches.
const INTERNAL_DEVICE_MARKER_FILE = "telemetry-internal-device";
// Created together with the first-launch claim. Installs that were first launched by an
// older build have threads already, so their next thread is not their first one.
const MILESTONES_DIR = "telemetry-milestones";
// Written at start and removed at a clean stop, so the next start can tell the
// previous one ended without stopping.
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
  uncleanStarts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  windowStartedAtMs: Schema.Number,
});
const decodeSessionMarker = Schema.decodeUnknownOption(Schema.fromJsonString(SessionMarker));
const encodeSessionMarker = Schema.encodeSync(Schema.fromJsonString(SessionMarker));
// Only versions a build writes, so a hand-edited marker cannot put text into an event.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,40})?$/;

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
      options?: RecordOptions,
    ) => Effect.Effect<void>;

    /** Records an install milestone at most once, and only for installs first launched on this build. */
    readonly recordMilestone: (
      event: TelemetryMilestone,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;

    readonly flush: Effect.Effect<void>;

    /** False when the install opted out; nothing is recorded or written then. */
    readonly enabled: boolean;
    readonly sessionId: string | undefined;

    readonly internalDevice: Effect.Effect<boolean>;
    readonly setInternalDevice: (
      enabled: boolean,
    ) => Effect.Effect<boolean, PlatformError.PlatformError>;
  }
>()("t3/telemetry/AnalyticsService") {
  static readonly layerTest = Layer.succeed(
    AnalyticsService,
    AnalyticsService.of({
      record: () => Effect.void,
      recordMilestone: () => Effect.void,
      flush: Effect.void,
      enabled: false,
      sessionId: undefined,
      internalDevice: Effect.succeed(false),
      setInternalDevice: (enabled) => Effect.succeed(enabled),
    }),
  );
}

function serverOsFromNodePlatform(platform: string): ClientOs {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    case "android":
      return "Android";
    default:
      return "other";
  }
}

/** @public */
/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig.ServerConfig;
  // Opted-out installs never read provider account files or write an identity.
  const identifier = telemetryConfig.enabled ? yield* getTelemetryIdentifier : null;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const deliveryRef = yield* Ref.make<DeliveryState>({
    failedBatch: [],
    batchAttempts: 0,
    failures: 0,
    retryAt: 0,
  });
  // The background flush and the shutdown flush must not send the same batch at once.
  const flushLock = yield* Semaphore.make(1);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";
  const hostPlatform = yield* HostProcess.Platform;
  const hostArchitecture = yield* HostProcess.Architecture;
  const isDesktopBackend = serverConfig.mode === "desktop";
  // The desktop app knows whether it is packaged; other servers classify themselves.
  const buildKind: UpcomputerBuildKind =
    (isDesktopBackend ? Option.getOrUndefined(telemetryConfig.desktopBuildKind) : undefined) ??
    resolveUpcomputerBuildKind({
      packaged: typeof __T3CODE_BUILD_CHANNEL__ !== "undefined",
      version: packageJson.version,
    });
  // Random per app launch (desktop) or per server start; never derived from the install.
  const desktopSessionId = isDesktopBackend
    ? Option.filter(telemetryConfig.desktopSessionId, (id) => UUID_PATTERN.test(id))
    : Option.none<string>();
  const sessionId = Option.isSome(desktopSessionId)
    ? desktopSessionId.value
    : yield* crypto.randomUUIDv4().pipe(Effect.catchCause(() => Effect.succeed(undefined)));
  const internalDeviceMarker = path.join(serverConfig.stateDir, INTERNAL_DEVICE_MARKER_FILE);
  // Read for every event, so creating the file by hand takes effect without a restart.
  const internalDevice = fileSystem
    .exists(internalDeviceMarker)
    .pipe(Effect.catchCause(() => Effect.succeed(false)));
  const setInternalDevice: AnalyticsService["Service"]["setInternalDevice"] = (enabled) =>
    (enabled
      ? fileSystem.writeFileString(internalDeviceMarker, "1\n")
      : fileSystem.remove(internalDeviceMarker, { force: true })
    ).pipe(Effect.as(enabled));

  const enqueueBufferedEvent = (
    uuid: string,
    event: string,
    isInternal: boolean,
    properties?: Readonly<Record<string, unknown>>,
    options?: RecordOptions,
  ) =>
    Effect.flatMap(DateTime.now, (now) =>
      Ref.modify(bufferRef, (current) => {
        const capturedAt =
          options?.capturedAtMs === undefined
            ? undefined
            : DateTime.make(options.capturedAtMs).pipe(Option.getOrUndefined);
        const earlierSessionId =
          options?.sessionId !== undefined && UUID_PATTERN.test(options.sessionId)
            ? options.sessionId
            : undefined;
        const appended = [
          ...current,
          {
            uuid,
            event,
            ...(properties ? { properties } : {}),
            capturedAt: DateTime.formatIso(capturedAt ?? now),
            isInternal,
            ...(earlierSessionId === undefined ? {} : { sessionId: earlierSessionId }),
          } satisfies BufferedAnalyticsEvent,
        ];

        const next =
          appended.length > telemetryConfig.maxBufferedEvents
            ? appended.slice(appended.length - telemetryConfig.maxBufferedEvents)
            : appended;

        return [
          {
            size: next.length,
            dropped: next.length !== appended.length,
          } as const,
          next,
        ] as const;
      }),
    );

  const sendBatch = Effect.fn("AnalyticsService.sendBatch")(function* (
    events: ReadonlyArray<BufferedAnalyticsEvent>,
  ) {
    if (!telemetryConfig.enabled || !identifier) return;

    const payload = {
      api_key: telemetryConfig.posthogKey,
      batch: events.map((event) => ({
        uuid: event.uuid,
        event: event.event,
        distinct_id: identifier,
        properties: {
          ...event.properties,
          $process_person_profile: false,
          platform: hostPlatform,
          wsl: Option.getOrUndefined(telemetryConfig.wslDistroName),
          arch: hostArchitecture,
          t3CodeVersion: packageJson.version,
          clientType,
          serverOs: serverOsFromNodePlatform(hostPlatform),
          serverArch: hostArchitecture,
          serverWslDistro: Option.getOrUndefined(telemetryConfig.wslDistroName),
          serverAppVersion: packageJson.version,
          serverMode: serverConfig.mode,
          desktopVersion: Option.getOrUndefined(telemetryConfig.desktopVersion),
          releaseChannel: Option.getOrUndefined(telemetryConfig.releaseChannel),
          buildKind,
          isInternal: event.isInternal,
          sessionId: event.sessionId ?? sessionId,
        },
        timestamp: event.capturedAt,
      })),
    };

    yield* HttpClientRequest.post(`${telemetryConfig.posthogHost}/batch/`).pipe(
      HttpClientRequest.bodyJson(payload),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.timeout(SEND_TIMEOUT),
    );
  });

  const takeBatch = Ref.modify(bufferRef, (current) => {
    const nextBatch = current.slice(0, telemetryConfig.flushBatchSize);
    return [nextBatch, current.slice(nextBatch.length)] as const;
  });

  const flush: AnalyticsService["Service"]["flush"] = Effect.gen(function* () {
    while (true) {
      const delivery = yield* Ref.get(deliveryRef);
      const batch = delivery.failedBatch.length > 0 ? delivery.failedBatch : yield* takeBatch;
      if (batch.length === 0) {
        return;
      }

      const sent = yield* Effect.result(sendBatch(batch));
      if (Result.isSuccess(sent)) {
        yield* Ref.set(deliveryRef, { failedBatch: [], batchAttempts: 0, failures: 0, retryAt: 0 });
        continue;
      }

      const failures = delivery.failures + 1;
      const batchAttempts = delivery.batchAttempts + 1;
      const retryAt = (yield* Clock.currentTimeMillis) + retryDelayMs(failures, yield* Random.next);
      if (batchAttempts < MAX_BATCH_ATTEMPTS) {
        yield* Ref.set(deliveryRef, { failedBatch: batch, batchAttempts, failures, retryAt });
        yield* Effect.logDebug("Failed to send telemetry batch; will retry", {
          attempt: batchAttempts,
          cause: sent.failure,
        });
        return;
      }
      yield* Ref.set(deliveryRef, { failedBatch: [], batchAttempts: 0, failures, retryAt });
      yield* Effect.logWarning("Dropped telemetry batch after repeated send failures", {
        events: batch.length,
        attempts: batchAttempts,
        cause: sent.failure,
      });
      return;
    }
  }).pipe(flushLock.withPermit);

  const flushWhenDue = Effect.gen(function* () {
    const { retryAt } = yield* Ref.get(deliveryRef);
    if ((yield* Clock.currentTimeMillis) >= retryAt) {
      yield* flush;
    }
  });

  const startedAtMs = yield* Clock.currentTimeMillis;
  const enabled = telemetryConfig.enabled && identifier !== null;
  const sessionMarkerPath = path.join(serverConfig.stateDir, SESSION_MARKER_FILE);
  const previousStart = enabled
    ? yield* fileSystem.readFileString(sessionMarkerPath).pipe(
        Effect.map((text) => Option.some(decodeSessionMarker(text))),
        Effect.catchCause(() => Effect.succeed(Option.none())),
      )
    : Option.none();
  // An unreadable marker still means the previous start did not stop cleanly.
  const previousMarker = Option.flatten(previousStart);
  const windowContinues = Option.exists(
    previousMarker,
    (marker) => startedAtMs - marker.windowStartedAtMs < CRASH_LOOP_WINDOW_MS,
  );
  const uncleanStarts = Option.isNone(previousStart)
    ? 0
    : (windowContinues ? Option.getOrThrow(previousMarker).uncleanStarts : 0) + 1;
  const windowStartedAtMs = windowContinues
    ? Option.getOrThrow(previousMarker).windowStartedAtMs
    : startedAtMs;
  const quietUntilMs =
    uncleanStarts > CRASH_LOOP_UNCLEAN_STARTS ? startedAtMs + CRASH_LOOP_QUIET_MS : 0;
  if (enabled) {
    yield* fileSystem
      .writeFileString(
        sessionMarkerPath,
        encodeSessionMarker({
          ...(sessionId === undefined ? {} : { sessionId }),
          version: packageJson.version,
          uncleanStarts,
          windowStartedAtMs,
        }),
      )
      .pipe(Effect.ignoreCause);
  }

  const record: AnalyticsService["Service"]["record"] = Effect.fn("AnalyticsService.record")(
    function* (event, properties, options) {
      if (!telemetryConfig.enabled || !identifier) return;
      if (quietUntilMs > 0 && (yield* Clock.currentTimeMillis) < quietUntilMs) return;

      // Telemetry is best effort: an event without a uuid is not sent. The
      // Node implementation throws (a defect) rather than failing, so catch both.
      const uuid = yield* Effect.exit(crypto.randomUUIDv7());
      if (Exit.isFailure(uuid)) return;

      const enqueueResult = yield* enqueueBufferedEvent(
        uuid.value,
        event,
        yield* internalDevice,
        properties,
        options,
      );
      if (enqueueResult.dropped) {
        yield* Effect.logDebug("analytics buffer full; dropping oldest event", {
          size: enqueueResult.size,
          event,
        });
      }
    },
  );

  yield* Effect.forever(Effect.sleep(FLUSH_INTERVAL_MS).pipe(Effect.flatMap(() => flushWhenDue)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);

  const milestonesDir = path.join(serverConfig.stateDir, MILESTONES_DIR);
  // "wx" fails when the marker exists, so concurrent claims report one event.
  const claimMarker = (markerPath: string) =>
    fileSystem.writeFileString(markerPath, "1\n", { flag: "wx" }).pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false)),
    );

  const recordMilestone: AnalyticsService["Service"]["recordMilestone"] = (event, properties) =>
    enabled
      ? claimMarker(path.join(milestonesDir, event)).pipe(
          Effect.flatMap((claimed) => (claimed ? record(event, properties) : Effect.void)),
        )
      : Effect.void;

  const startupContext = Option.getOrUndefined(telemetryConfig.desktopStartup);
  yield* record("server.started", startupContext === undefined ? undefined : { startupContext });
  if (Option.isSome(previousStart)) {
    // A desktop backend restart keeps the app's session, so the previous
    // session can be this one; compare the ids to tell a backend crash apart.
    const previous = Option.getOrUndefined(previousMarker);
    yield* record("app.unclean_exit", {
      ...(previous?.sessionId !== undefined && UUID_PATTERN.test(previous.sessionId)
        ? { previousSessionId: previous.sessionId }
        : {}),
      ...(previous?.version !== undefined && VERSION_PATTERN.test(previous.version)
        ? { previousVersion: previous.version }
        : {}),
      uncleanStarts,
    });
  }
  // Opted-out launches never write the marker: enabling telemetry later makes the
  // next desktop launch the first measured one.
  if (enabled && serverConfig.mode === "desktop") {
    const firstLaunch = yield* claimMarker(
      path.join(serverConfig.stateDir, FIRST_LAUNCH_MARKER_FILE),
    );
    if (firstLaunch) {
      yield* fileSystem.makeDirectory(milestonesDir, { recursive: true }).pipe(Effect.ignoreCause);
      yield* record("app.first_launch");
    }
  }
  // A backend restart inside a running app is not a launch the user made.
  if (startupContext === "launch") {
    yield* record("app.launched");
  }

  // Desktop quit stops the server, so this is the app session length there.
  // The marker goes before the flush: a stop killed during a slow send was still clean.
  yield* Effect.addFinalizer(() =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) => record("server.stopped", { uptimeMs: now - startedAtMs })),
      Effect.andThen(enabled ? fileSystem.remove(sessionMarkerPath, { force: true }) : Effect.void),
      Effect.ignoreCause,
      Effect.andThen(flush),
    ),
  );

  return AnalyticsService.of({
    record,
    recordMilestone,
    flush,
    enabled,
    sessionId,
    internalDevice,
    setInternalDevice,
  });
});

export const layer = Layer.effect(AnalyticsService, make);

const layerTest = AnalyticsService.layerTest;
