import type { ProviderDriverKind, ProviderInteractionMode } from "@upcomputer/contracts";

export const ACTIVATION_EVENT_SCHEMA_VERSION = 1;

export const ActivationEvent = {
  appFirstLaunch: "app.first_launch",
  appLaunched: "app.launched",
  serverStarted: "server.started",
  providerReadinessSucceeded: "provider.readiness.succeeded",
  providerReadinessFailed: "provider.readiness.failed",
  turnSubmitted: "provider.turn.submitted",
  turnCompleted: "provider.turn.completed",
  turnTerminated: "provider.turn.terminated",
} as const;

export type StartupContext =
  | "desktop-launch"
  | "desktop-restart"
  | "desktop-secondary"
  | "desktop-unknown"
  | "cli-browser"
  | "cli-headless";

export type TurnTerminalOutcome = "failed" | "interrupted" | "cancelled" | "provider-crash";

export type TelemetryErrorCategory =
  | "authentication"
  | "cancelled"
  | "interrupted"
  | "provider-crash"
  | "provider-unavailable"
  | "rate-limited"
  | "timeout"
  | "validation"
  | "unknown";

const common = () => ({ schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION });

export function classifyTelemetryError(cause: unknown): TelemetryErrorCategory {
  const tag =
    cause && typeof cause === "object" && "_tag" in cause && typeof cause._tag === "string"
      ? cause._tag.toLowerCase()
      : "";
  if (tag.includes("auth") || tag.includes("unauthorized")) return "authentication";
  if (tag.includes("rate") || tag.includes("quota")) return "rate-limited";
  if (tag.includes("timeout")) return "timeout";
  if (tag.includes("validation") || tag.includes("invalid")) return "validation";
  if (tag.includes("notfound") || tag.includes("notavailable") || tag.includes("unsupported")) {
    return "provider-unavailable";
  }
  return "unknown";
}

export function durationBucket(durationMs: number): string {
  if (durationMs < 1_000) return "under-1s";
  if (durationMs < 5_000) return "1s-5s";
  if (durationMs < 15_000) return "5s-15s";
  if (durationMs < 60_000) return "15s-60s";
  if (durationMs < 300_000) return "1m-5m";
  if (durationMs < 900_000) return "5m-15m";
  return "15m-plus";
}

export function providerDimensions(input: {
  readonly provider: ProviderDriverKind;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}) {
  return {
    ...common(),
    provider: input.provider,
    interactionMode: input.interactionMode ?? "default",
  } as const;
}

export function terminalDimensions(input: {
  readonly provider: ProviderDriverKind;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly durationMs: number;
}) {
  const safeDurationMs = Math.max(0, Math.round(input.durationMs));
  return {
    ...providerDimensions(input),
    durationMs: safeDurationMs,
    durationBucket: durationBucket(safeDurationMs),
  } as const;
}
