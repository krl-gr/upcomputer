/**
 * Events go straight to the Up.computer PostHog project. Each event carries a
 * uuid, so PostHog can tell a retried copy from a new event.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  resolveUpcomputerBuildKind,
  type UpcomputerBuildKind,
} from "@t3tools/shared/upcomputerIdentity";
import type { ClientOs } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
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
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { getTelemetryIdentity, type TelemetryOwner } from "./Identify.ts";
import * as UncleanExit from "./UncleanExit.ts";

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
  /** A fixed id makes PostHog keep one copy of an event sent more than once. */
  readonly uuid?: string;
}

interface DeliveryState {
  readonly failedBatch: ReadonlyArray<BufferedAnalyticsEvent>;
  readonly batchAttempts: number;
  readonly firstFailedAt: number;
  readonly failures: number;
  readonly retryAt: number;
}

// Retry delays shorter than this still wait for the next background check.
const FLUSH_INTERVAL_MS = 1_000;
// A hung send would hold the flush lock for the next background flush.
const SEND_TIMEOUT = "10 seconds";
// Quit and restart wait for this flush; events it cannot send in time are dropped.
const SHUTDOWN_FLUSH_TIMEOUT = "1 second";
// A failed batch is tried again until it has failed for this long. Ingest answers 503 when it
// cannot store a batch, and a broken Cloudflare location can take about 5 minutes to fail over.
// The waiting batch holds newer events back; `maxBufferedEvents` bounds them meanwhile.
const MAX_BATCH_RETRY_MS = 30 * 60_000;
const RETRY_BASE_DELAY_MS = 2_000;
// Clients can report any number of owner ids; past this many per observer, new ones
// are not sent. Each observer has its own cap, so client reports never crowd out the
// server's own.
const MAX_RECORDED_OWNERS = 1_000;
const RETRY_MAX_DELAY_MS = 300_000;
// These statuses reject the batch itself; unlike 408/429, retrying cannot help.
const REJECTED_BATCH_STATUSES = new Set([400, 401, 413]);

/** `random` is in [0, 1). */
function retryDelayMs(failures: number, random: number): number {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failures - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

/**
 * For an answer sent with analytics off. PostHog fills `$ip` from the request unless the
 * event carries a non-empty one (`sanitizeEvent` in PostHog's ingestion), so this is the
 * value PostHog writes for its own server-side events; `$geoip_disable` skips the location.
 */
const ANONYMOUS_EVENT_PROPERTIES = {
  $process_person_profile: false,
  $ip: "127.0.0.1",
  $geoip_disable: true,
} as const;

const UPCOMPUTER_POSTHOG_PROJECT_KEY = "phc_uqRUAQavAKuUny7uFxm8tqr6nyVDpdoSARKsWNzs8wBx";

const DesktopBuildKindConfig = Config.Literals(
  ["dev", "localtest", "rc", "nightly", "stable"],
  "T3CODE_DESKTOP_BUILD_KIND",
).pipe(Config.option);

/** The kind of build this server belongs to, as its events report it. */
export const serverBuildKind = Effect.gen(function* () {
  const { mode } = yield* ServerConfig.ServerConfig;
  // The desktop app knows whether it is packaged; other servers classify themselves.
  const desktopBuildKind = mode === "desktop" ? yield* DesktopBuildKindConfig : Option.none();
  return Option.getOrElse(desktopBuildKind, (): UpcomputerBuildKind =>
    resolveUpcomputerBuildKind({
      packaged: typeof __T3CODE_BUILD_CHANNEL__ !== "undefined",
      version: packageJson.version,
    }),
  );
});

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
  desktopSessionId: Config.String("T3CODE_DESKTOP_SESSION_ID").pipe(Config.option),
});

// Only bundles define it, so a server run from source is a dev build.
declare const __T3CODE_BUILD_CHANNEL__: string | undefined;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TelemetryMilestone =
  | "app.first_thread_created"
  | "app.first_message_sent"
  | "app.first_turn_completed"
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

    /**
     * Records `install.owner_observed` for each owner of this install that the
     * server read itself or a connecting client reported. Each owner is sent once
     * per server process, so reconnects and repeated reads are free.
     */
    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
    /**
     * Sends one event now and says whether PostHog took it. Only for answers the user
     * chose to send, so it also sends when analytics is off: then the event carries
     * just `properties` under a one-off anonymous id, asks PostHog to keep no IP address
     * or location, and the install stays unidentified.
     */
    readonly sendNow: (
      event: string,
      properties: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<boolean>;
    /** False when the install opted out; nothing is recorded or written then. */
    readonly enabled: boolean;
    readonly sessionId: string | undefined;

    readonly internalDevice: Effect.Effect<boolean>;
    readonly setInternalDevice: (
      enabled: boolean,
    ) => Effect.Effect<boolean, PlatformError.PlatformError>;
  }
>()("t3/telemetry/AnalyticsService") {}

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
/** @public */
export const make = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig;
  const hostEnvironment = yield* HostProcess.Environment;
  const awaitingShellConsent = hostEnvironment.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING === "1";
  // A managed policy can switch analytics off over the environment, never on.
  const policyAllows =
    ManagedPolicy.deniedBy(yield* ManagedPolicy.ManagedPolicy, "telemetry") === undefined;
  const shellConsentPending = Effect.sync(
    () => awaitingShellConsent && hostEnvironment.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING === "1",
  );
  // A cached PATH does not establish consent from the current login shell.
  const telemetryEnabled = Effect.suspend(() => {
    if (!telemetryConfig.enabled || !policyAllows) return Effect.succeed(false);
    if (!awaitingShellConsent) return Effect.succeed(true);
    if (hostEnvironment.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING === "1")
      return Effect.succeed(false);
    const preference = hostEnvironment.T3CODE_TELEMETRY_ENABLED;
    return Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(
      Config.withDefault(true),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: preference === undefined ? {} : { T3CODE_TELEMETRY_ENABLED: preference },
        }),
      ),
      Effect.orElseSucceed(() => false),
    );
  });
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig.ServerConfig;
  // Opted-out installs never read provider account files or write an identity.
  const { distinctId, installId } =
    telemetryConfig.enabled && policyAllows
      ? yield* getTelemetryIdentity
      : { distinctId: null, installId: null };
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* SecureRandom.SecureRandom;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const deliveryRef = yield* Ref.make<DeliveryState>({
    failedBatch: [],
    batchAttempts: 0,
    firstFailedAt: 0,
    failures: 0,
    retryAt: 0,
  });
  const recordedOwnersRef = yield* Ref.make<
    Readonly<Record<"server" | "client", ReadonlySet<string>>>
  >({ server: new Set(), client: new Set() });
  // The background flush and the shutdown flush must not send the same batch at once.
  const flushLock = yield* Semaphore.make(1);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";
  const hostPlatform = yield* HostProcess.Platform;
  const hostArchitecture = yield* HostProcess.Architecture;
  const isDesktopBackend = serverConfig.mode === "desktop";
  const buildKind = yield* serverBuildKind;
  // Random per app launch (desktop) or per server start; never derived from the install.
  const desktopSessionId = isDesktopBackend
    ? Option.filter(telemetryConfig.desktopSessionId, (id) => UUID_PATTERN.test(id))
    : Option.none<string>();
  const sessionId = Option.isSome(desktopSessionId)
    ? desktopSessionId.value
    : yield* crypto.uuidV4();
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
    if (!(yield* telemetryEnabled) || !distinctId) return;

    const payload = {
      api_key: telemetryConfig.posthogKey,
      batch: events.map((event) => ({
        uuid: event.uuid,
        event: event.event,
        distinct_id: distinctId,
        properties: {
          ...event.properties,
          ...(installId === null ? {} : { installId }),
          $process_person_profile: false,
          platform: hostPlatform,
          wsl: Option.getOrUndefined(telemetryConfig.wslDistroName),
          arch: hostArchitecture,
          t3CodeVersion: packageJson.version,
          telemetryChannel: ServerConfig.telemetryChannel,
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

  const sendNow: AnalyticsService["Service"]["sendNow"] = Effect.fn("AnalyticsService.sendNow")(
    function* (event, properties) {
      const uuid = yield* crypto.uuidV7();
      const capturedAt = DateTime.formatIso(yield* DateTime.now);
      if (distinctId !== null && (yield* telemetryEnabled)) {
        yield* sendBatch([
          { uuid, event, properties, capturedAt, isInternal: yield* internalDevice },
        ]);
        return true;
      }
      const entry = {
        uuid,
        event,
        distinct_id: yield* crypto.uuidV4(),
        properties: { ...properties, ...ANONYMOUS_EVENT_PROPERTIES },
        timestamp: capturedAt,
      };
      yield* HttpClientRequest.post(`${telemetryConfig.posthogHost}/batch/`).pipe(
        HttpClientRequest.bodyJson({ api_key: telemetryConfig.posthogKey, batch: [entry] }),
        Effect.flatMap(httpClient.execute),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeout(SEND_TIMEOUT),
      );
      return true;
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to send an event the user chose to send", { cause }).pipe(
        Effect.as(false),
      ),
    ),
  );

  const takeBatch = Ref.modify(bufferRef, (current) => {
    const nextBatch = current.slice(0, telemetryConfig.flushBatchSize);
    return [nextBatch, current.slice(nextBatch.length)] as const;
  });

  // Back off even after dropping rejected batches so bad API keys cannot drain the queue in a tight loop.
  const flush: AnalyticsService["Service"]["flush"] = Effect.gen(function* () {
    // Hold the buffer until consent is known; sendBatch drops it then if the user opted out.
    if (yield* shellConsentPending) return;
    while (true) {
      const delivery = yield* Ref.get(deliveryRef);
      const batch = delivery.failedBatch.length > 0 ? delivery.failedBatch : yield* takeBatch;
      if (batch.length === 0) {
        return;
      }

      const sent = yield* Effect.result(sendBatch(batch));
      if (Result.isSuccess(sent)) {
        yield* Ref.set(deliveryRef, {
          failedBatch: [],
          batchAttempts: 0,
          firstFailedAt: 0,
          failures: 0,
          retryAt: 0,
        });
        continue;
      }

      const now = yield* Clock.currentTimeMillis;
      const failures = delivery.failures + 1;
      const batchAttempts = delivery.batchAttempts + 1;
      const firstFailedAt = delivery.batchAttempts === 0 ? now : delivery.firstFailedAt;
      const retryAt = now + retryDelayMs(failures, yield* Random.next);
      const error = sent.failure;
      const rejected =
        error._tag === "HttpClientError" &&
        error.reason._tag === "StatusCodeError" &&
        REJECTED_BATCH_STATUSES.has(error.reason.response.status);
      if (!rejected && now - firstFailedAt < MAX_BATCH_RETRY_MS) {
        yield* Ref.set(deliveryRef, {
          failedBatch: batch,
          batchAttempts,
          firstFailedAt,
          failures,
          retryAt,
        });
        yield* Effect.logDebug("Failed to send telemetry batch; will retry", {
          attempt: batchAttempts,
          cause: error,
        });
        return;
      }
      yield* Ref.set(deliveryRef, {
        failedBatch: [],
        batchAttempts: 0,
        firstFailedAt: 0,
        failures,
        retryAt,
      });
      yield* Effect.logWarning(
        rejected
          ? "Dropped telemetry batch the endpoint rejected"
          : "Dropped telemetry batch after repeated send failures",
        { events: batch.length, attempts: batchAttempts, cause: error },
      );
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
  const enabled = telemetryConfig.enabled && policyAllows && distinctId !== null;
  const { quietUntilMs, markerError, uncleanExit } = enabled
    ? yield* UncleanExit.startSession({
        stateDir: serverConfig.stateDir,
        isDesktopBackend,
        sessionId,
        version: packageJson.version,
        startedAtMs,
      })
    : { quietUntilMs: 0, markerError: undefined, uncleanExit: Option.none() };

  const record: AnalyticsService["Service"]["record"] = Effect.fn("AnalyticsService.record")(
    function* (event, properties, options) {
      if (!telemetryConfig.enabled || !policyAllows || !distinctId) return;
      // Startup events wait in the buffer for shell consent; flush sends or drops them then.
      if (!(yield* shellConsentPending) && !(yield* telemetryEnabled)) return;
      if (quietUntilMs > 0 && (yield* Clock.currentTimeMillis) < quietUntilMs) return;

      // Catch Node UUID defects too; best-effort telemetry drops events without UUIDs.
      const uuid =
        options?.uuid !== undefined && UUID_PATTERN.test(options.uuid)
          ? Exit.succeed(options.uuid)
          : yield* Effect.exit(crypto.uuidV7());
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

  const recordOwners: AnalyticsService["Service"]["recordOwners"] = Effect.fn(
    "AnalyticsService.recordOwners",
  )((owners, observedBy) =>
    Effect.forEach(
      owners,
      ({ source, ownerId }) =>
        Ref.modify(recordedOwnersRef, (recorded) => {
          const key = `${source}:${ownerId}`;
          const seen = recorded[observedBy];
          return seen.has(key) || seen.size >= MAX_RECORDED_OWNERS
            ? [false, recorded]
            : [true, { ...recorded, [observedBy]: new Set(seen).add(key) }];
        }).pipe(
          Effect.flatMap((isNew) =>
            isNew
              ? record("install.owner_observed", { ownerSource: source, ownerId, observedBy })
              : Effect.void,
          ),
        ),
      { discard: true },
    ),
  );

  yield* Effect.forever(Effect.sleep(FLUSH_INTERVAL_MS).pipe(Effect.andThen(flushWhenDue)), {
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
  yield* record("server.started", {
    ...(startupContext === undefined ? {} : { startupContext }),
    ...(markerError === undefined ? {} : { sessionMarkerError: markerError }),
  });
  if (Option.isSome(uncleanExit)) {
    yield* record("app.unclean_exit", uncleanExit.value.properties, uncleanExit.value.options);
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
  // One budget for the whole stop, so the marker's file work cannot delay the flush's deadline.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const removeError = enabled
        ? yield* UncleanExit.endSession(serverConfig.stateDir)
        : undefined;
      const now = yield* Clock.currentTimeMillis;
      yield* record("server.stopped", {
        uptimeMs: now - startedAtMs,
        ...(removeError === undefined ? {} : { sessionMarkerError: removeError }),
      });
    }).pipe(
      Effect.ignoreCause,
      Effect.andThen(flush),
      Effect.timeout(SHUTDOWN_FLUSH_TIMEOUT),
      Effect.ignore,
    ),
  );

  return AnalyticsService.of({
    record,
    recordMilestone,
    flush,
    recordOwners,
    sendNow,
    enabled,
    sessionId,
    internalDevice,
    setInternalDevice,
  });
});

export const layer = Layer.effect(AnalyticsService, make);
