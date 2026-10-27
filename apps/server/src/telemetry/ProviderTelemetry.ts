/**
 * Provider onboarding telemetry: which provider CLIs an install has, whether
 * they are signed in, and whether a provider session opens. Only bounded values
 * leave the server: no paths, messages, account details or instance names.
 */
import type {
  OrchestrationV2ProviderMcpStatus,
  ProviderDriverKind,
  ProviderInstallState,
  ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import * as AntigravityInstallation from "../provider/AntigravityInstallation.ts";
import * as CodexInstallation from "../provider/CodexInstallation.ts";
import * as OpenCodeInstallation from "../provider/OpenCodeInstallation.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

export class ProviderReadinessAnalytics extends Context.Reference<{
  readonly record: (
    event: "provider.readiness.succeeded" | "provider.readiness.failed" | "provider.mcp.attach",
    properties: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>;
}>("t3/telemetry/ProviderReadinessAnalytics", {
  defaultValue: () => ({ record: () => Effect.void }),
}) {}

export const layerProviderReadinessAnalytics = Layer.effect(
  ProviderReadinessAnalytics,
  Effect.map(AnalyticsService.AnalyticsService, (analytics) => ({ record: analytics.record })),
);

export type ReadinessErrorCategory =
  | "cli_missing"
  | "not_authenticated"
  | "auth_expired"
  | "usage_limit"
  | "network"
  | "timeout"
  | "version_unsupported"
  | "spawn_failed"
  | "config_invalid"
  | "unknown";

type Classified = ReadinessErrorCategory | undefined;

const MAX_CAUSE_DEPTH = 8;

/** Errors nest through `cause`, a PlatformError's `reason`, or an Effect `Cause`. */
function causeChain(value: unknown): ReadonlyArray<unknown> {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = value;
  while (current !== undefined && current !== null && !seen.has(current)) {
    if (chain.length >= MAX_CAUSE_DEPTH) break;
    seen.add(current);
    if (Cause.isCause(current)) {
      current = Cause.squash(current);
      continue;
    }
    chain.push(current);
    if (PlatformError.isPlatformError(current)) {
      chain.push(current.reason);
    }
    current = Predicate.isObject(current) ? (current.cause ?? current.error) : undefined;
  }
  return chain;
}

const tagOf = (value: unknown) =>
  Predicate.hasProperty(value, "_tag") && Predicate.isString(value._tag) ? value._tag : undefined;

const numberField = (value: object, key: string) =>
  Predicate.hasProperty(value, key) && Predicate.isNumber(value[key]) ? value[key] : undefined;

const stringField = (value: object, key: string) =>
  Predicate.hasProperty(value, key) && Predicate.isString(value[key]) ? value[key] : undefined;

const NETWORK_ERRNO_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
]);

// JSON-RPC codes shared by ACP and the Codex app server.
function jsonRpcCategory(code: number | undefined, auth: boolean): Classified {
  if (code === -32601) return "version_unsupported";
  if (code === -32602) return "config_invalid";
  // ACP's authRequired, and xAI's rate limit extension.
  if (auth && code === -32000) return "not_authenticated";
  if (auth && code === -32003) return "usage_limit";
  return undefined;
}

function httpStatusCategory(status: number | undefined): Classified {
  if (status === 401 || status === 403) return "not_authenticated";
  if (status === 429) return "usage_limit";
  return undefined;
}

/** A decisive category from one error in the chain, or undefined to look further. */
function classifyError(error: unknown): Classified {
  if (!Predicate.isObject(error)) return undefined;
  if (Cause.isTimeoutError(error)) return "timeout";
  switch (tagOf(error)) {
    case "ProviderCommandNotFoundError":
      return "cli_missing";
    case "ProviderSetupError":
      switch (stringField(error, "operation")) {
        case "install":
          return "cli_missing";
        case "refresh":
          return "auth_expired";
        case "access":
        case "sharing":
        case "client":
        case "session":
          return "not_authenticated";
        case "runtime":
          return "spawn_failed";
        default:
          return undefined;
      }
    case "AcpRequestError":
      return jsonRpcCategory(numberField(error, "code"), true);
    case "CodexAppServerRequestError":
      return jsonRpcCategory(numberField(error, "code"), false);
    case "AcpProtocolParseError":
    case "CodexAppServerProtocolParseError":
      return "version_unsupported";
    // A Windows shell reports a missing command as exit code 9009.
    case "AcpProcessExitedError":
    case "CodexAppServerProcessExitedError":
      return numberField(error, "code") === 9009 ? "cli_missing" : undefined;
    case "OpenCodeRuntimeError":
      switch (stringField(error, "reason")) {
        case "timeout":
          return "timeout";
        case "version_unsupported":
          return "version_unsupported";
        default:
          return undefined;
      }
    case "UnauthorizedError":
      return "not_authenticated";
    case "HttpClientError": {
      const reason = Predicate.hasProperty(error, "reason") ? error.reason : undefined;
      if (tagOf(reason) === "TransportError") return "network";
      const response = Predicate.hasProperty(reason, "response") ? reason.response : undefined;
      return Predicate.isObject(response)
        ? httpStatusCategory(numberField(response, "status"))
        : undefined;
    }
    case "SchemaError":
      return "config_invalid";
    // PlatformError's SystemError reason.
    case "NotFound":
    case "PermissionDenied":
    case "TimedOut":
    case "Busy":
    case "Unknown":
      if (stringField(error, "module") !== "ChildProcess") return undefined;
      return tagOf(error) === "NotFound" ? "cli_missing" : "spawn_failed";
  }
  const errno = stringField(error, "code");
  const syscall = stringField(error, "syscall");
  if (errno !== undefined && syscall?.startsWith("spawn")) {
    return errno === "ENOENT" ? "cli_missing" : "spawn_failed";
  }
  if (errno !== undefined && NETWORK_ERRNO_CODES.has(errno)) return "network";
  return undefined;
}

/** A process that never came up, when nothing in the chain says why. */
function classifyFallback(error: unknown): Classified {
  switch (tagOf(error)) {
    case "AcpSpawnError":
    case "CodexAppServerSpawnError":
    case "AcpProcessExitedError":
    case "CodexAppServerProcessExitedError":
      return "spawn_failed";
    case "OpenCodeRuntimeError":
      return Predicate.isObject(error) &&
        stringField(error, "operation") === "startOpenCodeServerProcess"
        ? "spawn_failed"
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Coarse kind of a failed session open, read from error tags, codes and
 * structured fields only. Error text is never matched or sent: provider errors
 * can carry paths and account details. The outermost decisive error wins, since
 * wrappers that set a structured reason know more than the cause they wrap.
 */
export function readinessErrorCategory(cause: unknown): ReadinessErrorCategory {
  const chain = causeChain(cause);
  for (const error of chain) {
    const category = classifyError(error);
    if (category !== undefined) return category;
  }
  for (const error of chain) {
    const category = classifyFallback(error);
    if (category !== undefined) return category;
  }
  return "unknown";
}

/**
 * `provider.mcp.attach` properties for a change in a session's MCP status: one
 * event whenever the t3-code server's outcome changes, and one for the user's
 * own servers when their failures appear, grow or clear. Their names are only
 * counted, since users choose them.
 */
export function mcpAttachEvents(
  driver: ProviderDriverKind,
  previous: OrchestrationV2ProviderMcpStatus | undefined,
  next: OrchestrationV2ProviderMcpStatus | undefined,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (next === undefined) return [];
  const events: Array<Readonly<Record<string, unknown>>> = [];
  const { t3, userServerCount } = next;
  if (
    t3 !== undefined &&
    (t3.outcome !== previous?.t3?.outcome || t3.reason !== previous.t3.reason)
  ) {
    events.push({
      provider: driver,
      server: "t3",
      outcome: t3.outcome,
      ...(t3.reason === undefined ? {} : { reason: t3.reason }),
      failedCount: t3.outcome === "attached" ? 0 : 1,
      userServerCount,
    });
  }
  const failedCount = next.failedUserServers.length;
  const previousFailedCount = previous?.failedUserServers.length ?? 0;
  if (failedCount > previousFailedCount || (failedCount === 0 && previousFailedCount > 0)) {
    events.push({
      provider: driver,
      server: "user",
      outcome: failedCount === 0 ? "attached" : "failed",
      failedCount,
      userServerCount,
    });
  }
  return events;
}

const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]{1,32})?$/;

/** Bounded per-provider state. Instance ids are user-chosen, so only the driver is sent. */
export function providerStatusProperties(provider: ServerProvider) {
  const version = provider.version?.trim();
  return {
    provider: provider.driver,
    enabled: provider.enabled,
    installed: provider.installed,
    ...(version === undefined || version === ""
      ? {}
      : { version: VERSION_PATTERN.test(version) ? version : "unparsed" }),
    status: provider.status,
    authStatus: provider.auth.status,
    ...(provider.compatibilityAdvisory === undefined
      ? {}
      : { compatibility: provider.compatibilityAdvisory.status }),
  };
}

/**
 * Records `provider.status.observed` for each provider when the server first
 * sees it and whenever its bounded state changes, so a funnel can tell "no CLI",
 * "CLI but signed out" and "ready" apart, and see an install or login land.
 */
export const layerProviderStatusTelemetry = Layer.effectDiscard(
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    const registry = yield* ProviderRegistry.ProviderRegistry;
    const lastSeen = new Map<string, string>();
    const observe = (providers: ReadonlyArray<ServerProvider>) =>
      Effect.forEach(
        providers,
        (provider) => {
          // The placeholder drivers publish before their first probe says
          // installed: false, which would read as "no CLI" on every launch.
          if (provider.statusPending === true) return Effect.void;
          const properties = providerStatusProperties(provider);
          const key = JSON.stringify(properties);
          if (lastSeen.get(provider.instanceId) === key) return Effect.void;
          lastSeen.set(provider.instanceId, key);
          return analytics.record("provider.status.observed", properties);
        },
        { discard: true },
      );
    yield* registry.getProviders.pipe(
      Effect.flatMap(observe),
      Effect.andThen(Stream.runForEach(registry.streamChanges, observe)),
      Effect.forkScoped,
    );
  }),
);

const isInstalling = (state: ProviderInstallState | undefined) =>
  state?.phase === "downloading" || state?.phase === "extracting" || state?.phase === "verifying";

/**
 * Records the app-managed downloads (Codex for "Continue with ChatGPT", and
 * Antigravity): `provider.install.started`, then `provider.install.finished`
 * with outcome succeeded, failed or cancelled and durationMs.
 */
export const recordInstallTransitions = (
  changes: Stream.Stream<ProviderInstallState>,
  record: (event: string, properties: Readonly<Record<string, unknown>>) => Effect.Effect<void>,
) => {
  let previous: ProviderInstallState | undefined;
  let startedAtMs = 0;
  return Stream.runForEach(changes, (next) =>
    Effect.gen(function* () {
      const before = previous;
      previous = next;
      // The first value is the state at startup, not a transition.
      if (before === undefined) return;
      if (!isInstalling(before) && isInstalling(next)) {
        startedAtMs = yield* Clock.currentTimeMillis;
        yield* record("provider.install.started", { provider: next.driver });
      } else if (
        isInstalling(before) &&
        (next.phase === "succeeded" || next.phase === "failed" || next.phase === "cancelled")
      ) {
        yield* record("provider.install.finished", {
          provider: next.driver,
          outcome: next.phase,
          durationMs: (yield* Clock.currentTimeMillis) - startedAtMs,
        });
      }
    }),
  );
};

export const layerProviderInstallTelemetry = Layer.effectDiscard(
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    const codex = yield* CodexInstallation.CodexInstallation;
    const antigravity = yield* AntigravityInstallation.AntigravityInstallation;
    const openCode = yield* OpenCodeInstallation.OpenCodeInstallation;
    yield* Effect.forEach(
      [codex.changes, antigravity.changes, openCode.changes],
      (changes) => recordInstallTransitions(changes, analytics.record).pipe(Effect.forkScoped),
      { discard: true },
    );
  }),
);
