/**
 * Provider onboarding telemetry: which provider CLIs an install has, whether
 * they are signed in, and whether a provider session opens. Only bounded values
 * leave the server: no paths, messages, account details or instance names.
 */
import type { ProviderInstallState, ServerProvider } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import * as AntigravityInstallation from "../provider/AntigravityInstallation.ts";
import * as CodexInstallation from "../provider/CodexInstallation.ts";
import * as OpenCodeInstallation from "../provider/OpenCodeInstallation.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

export class ProviderReadinessAnalytics extends Context.Reference<{
  readonly record: (
    event: "provider.readiness.succeeded" | "provider.readiness.failed",
    properties: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>;
}>("t3/telemetry/ProviderReadinessAnalytics", {
  defaultValue: () => ({ record: () => Effect.void }),
}) {}

export const layerProviderReadinessAnalytics = Layer.effect(
  ProviderReadinessAnalytics,
  Effect.map(AnalyticsService.AnalyticsService, (analytics) => ({ record: analytics.record })),
);

export type ReadinessErrorCategory = "cli-missing" | "auth" | "timeout" | "unknown";

const MAX_CAUSE_DEPTH = 8;

function causeChain(value: unknown): ReadonlyArray<unknown> {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = value;
  while (current !== undefined && current !== null && !seen.has(current)) {
    if (chain.length >= MAX_CAUSE_DEPTH) break;
    seen.add(current);
    chain.push(current);
    current = Predicate.isObject(current) ? (current.cause ?? current.error) : undefined;
  }
  return chain;
}

/**
 * Coarse kind of a failed session open. The cause text is only matched here,
 * never sent: provider errors can carry paths and account details.
 */
export function readinessErrorCategory(cause: unknown): ReadinessErrorCategory {
  const texts = causeChain(cause).flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!Predicate.isObject(entry)) return [];
    return [entry._tag, entry.code, entry.message].filter(Predicate.isString);
  });
  const text = texts.join("\n");
  if (/\bENOENT\b|not found on PATH|command not found|No such file or directory/i.test(text)) {
    return "cli-missing";
  }
  if (
    /not (?:logged|signed) in|\blog ?in\b|sign ?in|unauthori[sz]ed|authenticat|\b401\b|api key|credential/i.test(
      text,
    )
  ) {
    return "auth";
  }
  if (/timeout|timed out/i.test(text)) return "timeout";
  return "unknown";
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
