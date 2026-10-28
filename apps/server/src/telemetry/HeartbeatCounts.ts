/**
 * Counts a product feature adds to `server.boot.heartbeat`. Kept apart from the
 * heartbeat itself, so features can register without importing core services.
 */
import * as Effect from "effect/Effect";

/** Counts a product feature adds to the heartbeat, keyed by property name. */
export type HeartbeatCountsResolver = Effect.Effect<Readonly<Record<string, number>>, Error>;

let resolver: HeartbeatCountsResolver | undefined;

/** Registers the feature's counts for the lifetime of the calling scope. */
export const registerHeartbeatCounts = (value: HeartbeatCountsResolver) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      resolver = value;
    }),
    () =>
      Effect.sync(() => {
        if (resolver === value) resolver = undefined;
      }),
  );

export const featureHeartbeatCounts: HeartbeatCountsResolver = Effect.suspend(
  () => resolver ?? Effect.succeed({}),
);
