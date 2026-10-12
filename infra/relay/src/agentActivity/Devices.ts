import type {
  RelayAgentAwarenessPreferences,
  RelayClientDeviceRecord,
  RelayDeviceRegistrationRequest,
  RelayWebPushSubscription,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/sql/SqlError";
import { and, eq, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayLiveActivities, relayMobileDevices } from "../persistence/schema.ts";

export class DeviceRegistrationPersistenceError extends Schema.TaggedError<DeviceRegistrationPersistenceError>()(
  "DeviceRegistrationPersistenceError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
    stage: Schema.Literals([
      "transaction",
      "find-push-token-holders",
      "claim-push-token",
      "claim-push-to-start-token",
      "upsert-device",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to persist mobile device registration for ${this.userId}/${this.deviceId} during ${this.stage}.`;
  }
}

/**
 * Another account holds this web push endpoint and the request did not prove
 * it comes from the same browser.
 */
export class WebPushSubscriptionConflictError extends Schema.TaggedError<WebPushSubscriptionConflictError>()(
  "WebPushSubscriptionConflictError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
  },
) {
  override get message(): string {
    return `Web push endpoint for ${this.userId}/${this.deviceId} belongs to another account.`;
  }
}

export class DeviceUnregistrationPersistenceError extends Schema.TaggedError<DeviceUnregistrationPersistenceError>()(
  "DeviceUnregistrationPersistenceError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
    stage: Schema.Literals(["delete-live-activity", "delete-device"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister mobile device ${this.userId}/${this.deviceId} during ${this.stage}.`;
  }
}

export class DeviceListPersistenceError extends Schema.TaggedError<DeviceListPersistenceError>()(
  "DeviceListPersistenceError",
  {
    userId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to list mobile devices for ${this.userId}.`;
  }
}

export class WebPushTargetLookupPersistenceError extends Schema.TaggedError<WebPushTargetLookupPersistenceError>()(
  "WebPushTargetLookupPersistenceError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read the web push subscription of ${this.userId}/${this.deviceId}.`;
  }
}

export interface WebPushTarget {
  readonly subscription: RelayWebPushSubscription;
  readonly preferences: RelayAgentAwarenessPreferences;
}

export class WebPushSubscriptionRemovalPersistenceError extends Schema.TaggedError<WebPushSubscriptionRemovalPersistenceError>()(
  "WebPushSubscriptionRemovalPersistenceError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to remove the web push subscription of ${this.userId}/${this.deviceId}.`;
  }
}

export class Devices extends Context.Service<
  Devices,
  {
    readonly register: (input: {
      readonly userId: string;
      readonly registration: RelayDeviceRegistrationRequest;
    }) => Effect.Effect<
      void,
      DeviceRegistrationPersistenceError | WebPushSubscriptionConflictError
    >;
    readonly unregister: (input: {
      readonly userId: string;
      readonly deviceId: string;
    }) => Effect.Effect<void, DeviceUnregistrationPersistenceError>;
    readonly listForUser: (input: {
      readonly userId: string;
    }) => Effect.Effect<ReadonlyArray<RelayClientDeviceRecord>, DeviceListPersistenceError>;
    /** The current subscription of a web device, or null once it is gone. */
    readonly findWebPushTarget: (input: {
      readonly userId: string;
      readonly deviceId: string;
    }) => Effect.Effect<WebPushTarget | null, WebPushTargetLookupPersistenceError>;
    /**
     * Forgets a web device whose push service reported the subscription gone.
     * Matches the endpoint, so a device that has re-subscribed meanwhile stays.
     */
    readonly removeWebPushSubscription: (input: {
      readonly userId: string;
      readonly deviceId: string;
      readonly endpoint: string;
    }) => Effect.Effect<void, WebPushSubscriptionRemovalPersistenceError>;
  }
>()("t3code-relay/agentActivity/Devices") {}

/** Compares secrets without exiting early on the first differing character. */
function sameSecret(stored: string | null, presented: string): boolean {
  if (stored === null || stored.length !== presented.length) return false;
  let difference = 0;
  for (let index = 0; index < stored.length; index++) {
    difference |= stored.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return difference === 0;
}

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  /**
   * A web endpoint moves to another account only with the subscription's own
   * keys. The auth secret is known only to the browser and the relay, so a
   * matching pair shows the same browser signed in to a different account;
   * an endpoint alone is not proof of ownership. Locks the holding rows for
   * the surrounding transaction.
   */
  const ensureWebPushEndpointOwnership = Effect.fnUntraced(function* (input: {
    readonly userId: string;
    readonly deviceId: string;
    readonly subscription: RelayWebPushSubscription;
  }) {
    const holders = yield* db
      .select({
        userId: relayMobileDevices.userId,
        platform: relayMobileDevices.platform,
        p256dh: relayMobileDevices.webPushP256dh,
        auth: relayMobileDevices.webPushAuth,
      })
      .from(relayMobileDevices)
      .where(eq(relayMobileDevices.pushToken, input.subscription.endpoint))
      .for("update")
      .pipe(
        Effect.mapError(
          (cause) =>
            new DeviceRegistrationPersistenceError({
              userId: input.userId,
              deviceId: input.deviceId,
              stage: "find-push-token-holders",
              cause,
            }),
        ),
      );
    const foreign = holders.some(
      (holder) =>
        holder.userId !== input.userId &&
        holder.platform === "web" &&
        !(
          sameSecret(holder.auth, input.subscription.auth) &&
          sameSecret(holder.p256dh, input.subscription.p256dh)
        ),
    );
    if (foreign) {
      return yield* new WebPushSubscriptionConflictError({
        userId: input.userId,
        deviceId: input.deviceId,
      });
    }
  });

  return Devices.of({
    register: Effect.fn("relay.devices.register")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.mobile.device_id": input.registration.deviceId,
      });
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      const registration = input.registration;
      // A web device's subscription endpoint is its push token.
      const pushToken = registration.webPush?.endpoint ?? registration.pushToken;

      // The drizzle handle is alchemy's lazy proxy chain: it only becomes a
      // real Effect when consumed via `yield*`. Handing it to Effect.all sends
      // the raw Proxy into the fiber runtime, which spins the isolate at 100%
      // CPU (registrations then hang until the client aborts) — keep every db
      // chain directly yielded.
      const write = Effect.gen(function* () {
        if (registration.webPush) {
          yield* ensureWebPushEndpointOwnership({
            userId: input.userId,
            deviceId: registration.deviceId,
            subscription: registration.webPush,
          });
        }
        if (pushToken) {
          yield* db
            .update(relayMobileDevices)
            .set({ pushToken: null, updatedAt })
            .where(
              registration.webPush
                ? eq(relayMobileDevices.pushToken, pushToken)
                : // A native token never takes over a web subscription.
                  and(
                    eq(relayMobileDevices.pushToken, pushToken),
                    ne(relayMobileDevices.platform, "web"),
                  ),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DeviceRegistrationPersistenceError({
                    userId: input.userId,
                    deviceId: registration.deviceId,
                    stage: "claim-push-token",
                    cause,
                  }),
              ),
            );
        }
        if (registration.pushToStartToken) {
          yield* db
            .update(relayMobileDevices)
            .set({ pushToStartToken: null, updatedAt })
            .where(eq(relayMobileDevices.pushToStartToken, registration.pushToStartToken))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DeviceRegistrationPersistenceError({
                    userId: input.userId,
                    deviceId: registration.deviceId,
                    stage: "claim-push-to-start-token",
                    cause,
                  }),
              ),
            );
        }

        yield* db
          .insert(relayMobileDevices)
          .values({
            userId: input.userId,
            deviceId: registration.deviceId,
            label: registration.label,
            platform: registration.platform,
            iosMajorVersion: registration.iosMajorVersion ?? null,
            androidApiLevel: registration.androidApiLevel ?? null,
            appVersion: registration.appVersion ?? null,
            bundleId: registration.bundleId ?? null,
            apsEnvironment: registration.apsEnvironment ?? null,
            pushToken: pushToken ?? null,
            pushToStartToken: registration.pushToStartToken ?? null,
            webPushP256dh: registration.webPush?.p256dh ?? null,
            webPushAuth: registration.webPush?.auth ?? null,
            preferencesJson: registration.preferences,
            createdAt: updatedAt,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: [relayMobileDevices.userId, relayMobileDevices.deviceId],
            set: {
              platform: registration.platform,
              label: registration.label,
              iosMajorVersion: registration.iosMajorVersion ?? null,
              androidApiLevel: registration.androidApiLevel ?? null,
              appVersion: registration.appVersion ?? null,
              // Preserve routing from newer app builds when an older build
              // re-registers without these fields.
              bundleId: sql`coalesce(excluded.bundle_id, ${relayMobileDevices.bundleId})`,
              apsEnvironment: sql`coalesce(
                  excluded.aps_environment,
                  ${relayMobileDevices.apsEnvironment}
                )`,
              pushToken: sql`coalesce(excluded.push_token, ${relayMobileDevices.pushToken})`,
              pushToStartToken: sql`coalesce(
                  excluded.push_to_start_token,
                  ${relayMobileDevices.pushToStartToken}
                )`,
              webPushP256dh: registration.webPush?.p256dh ?? null,
              webPushAuth: registration.webPush?.auth ?? null,
              preferencesJson: registration.preferences,
              updatedAt,
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new DeviceRegistrationPersistenceError({
                  userId: input.userId,
                  deviceId: registration.deviceId,
                  stage: "upsert-device",
                  cause,
                }),
            ),
          );
      });
      // Checking who holds the endpoint and claiming it must not interleave
      // with another registration of the same endpoint.
      yield* db.$client.withTransaction(write).pipe(
        Effect.mapError((cause) =>
          SqlError.isSqlError(cause)
            ? new DeviceRegistrationPersistenceError({
                userId: input.userId,
                deviceId: registration.deviceId,
                stage: "transaction",
                cause,
              })
            : cause,
        ),
      );
    }),
    unregister: Effect.fn("relay.devices.unregister")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.mobile.device_id": input.deviceId,
      });
      // Same proxy-chain constraint as register above: db chains must be
      // consumed via `yield*`, never passed to Effect.all.
      yield* db
        .delete(relayLiveActivities)
        .where(
          and(
            eq(relayLiveActivities.userId, input.userId),
            eq(relayLiveActivities.deviceId, input.deviceId),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeviceUnregistrationPersistenceError({
                userId: input.userId,
                deviceId: input.deviceId,
                stage: "delete-live-activity",
                cause,
              }),
          ),
        );
      yield* db
        .delete(relayMobileDevices)
        .where(
          and(
            eq(relayMobileDevices.userId, input.userId),
            eq(relayMobileDevices.deviceId, input.deviceId),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeviceUnregistrationPersistenceError({
                userId: input.userId,
                deviceId: input.deviceId,
                stage: "delete-device",
                cause,
              }),
          ),
        );
    }),
    listForUser: Effect.fn("relay.devices.listForUser")(function* (input) {
      const rows = yield* db
        .select({
          deviceId: relayMobileDevices.deviceId,
          label: relayMobileDevices.label,
          platform: relayMobileDevices.platform,
          iosMajorVersion: relayMobileDevices.iosMajorVersion,
          androidApiLevel: relayMobileDevices.androidApiLevel,
          appVersion: relayMobileDevices.appVersion,
          preferences: relayMobileDevices.preferencesJson,
          updatedAt: relayMobileDevices.updatedAt,
        })
        .from(relayMobileDevices)
        // Listings are for mobile clients; web devices manage themselves.
        .where(
          and(eq(relayMobileDevices.userId, input.userId), ne(relayMobileDevices.platform, "web")),
        )
        .pipe(
          Effect.mapError(
            (cause) => new DeviceListPersistenceError({ userId: input.userId, cause }),
          ),
        );
      return rows.flatMap(({ platform, ...row }) =>
        platform === "web"
          ? []
          : [
              {
                deviceId: row.deviceId,
                label: row.label,
                platform,
                iosMajorVersion: row.iosMajorVersion,
                androidApiLevel: row.androidApiLevel,
                appVersion: row.appVersion,
                notifications: {
                  enabled: row.preferences.notificationsEnabled,
                  notifyOnApproval: row.preferences.notifyOnApproval,
                  notifyOnInput: row.preferences.notifyOnInput,
                  notifyOnCompletion: row.preferences.notifyOnCompletion,
                  notifyOnFailure: row.preferences.notifyOnFailure,
                },
                liveActivities: {
                  enabled: row.preferences.liveActivitiesEnabled,
                },
                updatedAt: row.updatedAt,
              },
            ],
      );
    }),
    findWebPushTarget: Effect.fn("relay.devices.find_web_push_target")(function* (input) {
      const rows = yield* db
        .select({
          endpoint: relayMobileDevices.pushToken,
          p256dh: relayMobileDevices.webPushP256dh,
          auth: relayMobileDevices.webPushAuth,
          preferences: relayMobileDevices.preferencesJson,
        })
        .from(relayMobileDevices)
        .where(
          and(
            eq(relayMobileDevices.userId, input.userId),
            eq(relayMobileDevices.deviceId, input.deviceId),
            eq(relayMobileDevices.platform, "web"),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new WebPushTargetLookupPersistenceError({
                userId: input.userId,
                deviceId: input.deviceId,
                cause,
              }),
          ),
        );
      const row = rows[0];
      if (!row?.endpoint || !row.p256dh || !row.auth) return null;
      return {
        subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        preferences: row.preferences,
      };
    }),
    removeWebPushSubscription: Effect.fn("relay.devices.remove_web_push_subscription")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({ "relay.mobile.device_id": input.deviceId });
        yield* db
          .delete(relayMobileDevices)
          .where(
            and(
              eq(relayMobileDevices.userId, input.userId),
              eq(relayMobileDevices.deviceId, input.deviceId),
              eq(relayMobileDevices.platform, "web"),
              eq(relayMobileDevices.pushToken, input.endpoint),
            ),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new WebPushSubscriptionRemovalPersistenceError({
                  userId: input.userId,
                  deviceId: input.deviceId,
                  cause,
                }),
            ),
          );
      },
    ),
  });
});

export const layer = Layer.effect(Devices, make);
