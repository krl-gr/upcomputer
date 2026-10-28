/**
 * What an install has set up, for `server.boot.heartbeat`. Counts go out as
 * buckets: a returning user's setup is what matters, not its exact size.
 */
import type { ScheduledTask, ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_LINK_REVOKED, CLOUD_LINKED_USER_ID } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { isLoopbackHost } from "../startupAccess.ts";
import { featureHeartbeatCounts } from "./HeartbeatCounts.ts";

const BUCKETS: ReadonlyArray<readonly [max: number, label: string]> = [
  [0, "0"],
  [1, "1"],
  [4, "2-4"],
  [9, "5-9"],
  [24, "10-24"],
  [99, "25-99"],
  [499, "100-499"],
];

export function countBucket(count: number): string {
  for (const [max, label] of BUCKETS) if (count <= max) return label;
  return "500+";
}

/** Enabled scheduled tasks, split by whether a webhook or the clock starts them. */
function scheduledTaskCounts(tasks: ReadonlyArray<Pick<ScheduledTask, "enabled" | "schedule">>) {
  const enabled = tasks.filter((task) => task.enabled);
  const webhookCount = enabled.filter((task) => task.schedule.type === "webhook").length;
  return { scheduledTaskCount: enabled.length - webhookCount, webhookCount };
}

/** Provider instances that are on, installed and not signed out. */
function configuredProviderCount(providers: ReadonlyArray<ServerProvider>): number {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      (provider.status === "ready" || provider.status === "warning") &&
      provider.auth.status !== "unauthenticated",
  ).length;
}

// Probes start with the server; a heartbeat sent before they finish would
// report every provider as missing.
const PROVIDER_PROBE_WAIT = "30 seconds";

const settledProviders = Effect.gen(function* () {
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  if (Option.isNone(registry)) return [];
  const current = yield* registry.value.getProviders;
  if (!current.some((provider) => provider.statusPending === true)) return current;
  const settled = yield* registry.value.streamChanges.pipe(
    Stream.filter((providers) => !providers.some((provider) => provider.statusPending === true)),
    Stream.runHead,
    Effect.timeoutOption(PROVIDER_PROBE_WAIT),
  );
  return Option.getOrElse(Option.flatten(settled), () => current);
});

/** Linked to Up.computer Connect, listening beyond loopback, or shared over Tailscale. */
const remoteAccess = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  if (config.tailscaleServeEnabled || !isLoopbackHost(config.host)) return true;
  const secrets = yield* Effect.serviceOption(ServerSecretStore.ServerSecretStore);
  if (Option.isNone(secrets)) return false;
  const [linked, revoked] = yield* Effect.all([
    secrets.value.get(CLOUD_LINKED_USER_ID),
    secrets.value.get(CLOUD_LINK_REVOKED),
  ]);
  return Option.isSome(linked) && Option.isNone(revoked);
});

const scheduledTasks = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(ScheduledTaskService.ScheduledTaskService);
  if (Option.isNone(service)) return { scheduledTaskCount: 0, webhookCount: 0 };
  return scheduledTaskCounts((yield* service.value.list()).tasks);
});

/** Each part is best effort: one that cannot be read is left out, not reported as zero. */
const part = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.asSome,
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not read a heartbeat count", { part: label, cause }).pipe(
        Effect.as(Option.none<A>()),
      ),
    ),
  );

export const heartbeatFeatureProperties = Effect.gen(function* () {
  const [schedules, providers, remote, feature] = yield* Effect.all(
    [
      part("scheduled-tasks", scheduledTasks),
      part("providers", Effect.map(settledProviders, configuredProviderCount)),
      part("remote-access", remoteAccess),
      part("feature", featureHeartbeatCounts),
    ],
    { concurrency: "unbounded" },
  );
  const counts: Record<string, number> = {
    ...Option.getOrUndefined(feature),
    ...Option.getOrUndefined(schedules),
    ...(Option.isSome(providers) ? { configuredProviderCount: providers.value } : {}),
  };
  const properties: Record<string, string | boolean> = Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [key, countBucket(count)] as const),
  );
  if (Option.isSome(remote)) properties.remoteAccess = remote.value;
  return properties;
});
