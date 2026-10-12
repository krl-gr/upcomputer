import {
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
  type RelayDeliveryResult,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as RelayConfiguration from "../Config.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as AgentActivityRows from "./AgentActivityRows.ts";
import * as Devices from "./Devices.ts";
import type * as LiveActivities from "./LiveActivities.ts";
import * as WebPushClient from "./WebPushClient.ts";
import * as WebPushDeliveryQueueSender from "./WebPushDeliveryQueueSender.ts";
import { statusForPhase } from "./agentActivityAggregate.ts";
import { shouldAlertForActivity } from "./agentActivityAlerts.ts";
import { isExpiredAgentActivityState, notificationForActivity } from "./agentActivityPayloads.ts";
import { MAX_WEB_PUSH_PLAINTEXT_BYTES } from "./webPushCrypto.ts";

/** Queue age after which an alert is no longer worth showing. */
const MAX_QUEUE_AGE_MS = 5 * 60_000;
/** How long a push service holds an alert for an offline device. */
export const WEB_PUSH_TTL_SECONDS = 4 * 60 * 60;

export const WebPushDeliveryJob = Schema.Struct({
  userId: Schema.String,
  deviceId: Schema.String,
  endpoint: Schema.String,
  state: RelayAgentActivityState,
  queuedAt: Schema.Number,
});
export type WebPushDeliveryJob = typeof WebPushDeliveryJob.Type;
const decodeJob = Schema.decodeUnknownEffect(WebPushDeliveryJob);
const decodePreferences = Schema.decodeUnknownOption(
  Schema.fromJsonString(RelayAgentAwarenessPreferences),
);

export class WebPushDeliveryError extends Schema.TaggedError<WebPushDeliveryError>()(
  "WebPushDeliveryError",
  {
    operation: Schema.Literals(["enqueue", "decode-job"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to ${this.operation} web push delivery.`;
  }
}

/**
 * What the service worker shows. `tag` matches the in-app notification tag,
 * so an open app and a push for the same thread replace each other.
 */
export interface WebPushNotification {
  readonly title: string;
  readonly body: string;
  readonly path: string;
  readonly tag: string;
}

/** Encodes the notification within one push message, shortening text if needed. */
export function encodeWebPushNotification(notification: WebPushNotification): Uint8Array {
  const encoder = new TextEncoder();
  let current = notification;
  let encoded = encoder.encode(JSON.stringify(current));
  while (encoded.length > MAX_WEB_PUSH_PLAINTEXT_BYTES) {
    const field = current.body.length >= current.title.length ? "body" : "title";
    const characters = Array.from(current[field]);
    if (characters.length <= 1) {
      // Only the path and tag remain; a generic alert still opens the app.
      current = { title: "Up.computer", body: "", path: "/", tag: "agent-activity" };
      encoded = encoder.encode(JSON.stringify(current));
      break;
    }
    current = {
      ...current,
      [field]: `${characters
        .slice(0, Math.floor(characters.length / 2))
        .join("")
        .trimEnd()}…`,
    };
    encoded = encoder.encode(JSON.stringify(current));
  }
  return encoded;
}

export class WebPushDeliveries extends Context.Service<
  WebPushDeliveries,
  {
    /** Queues an alert for a web device; null when nothing should be sent. */
    readonly enqueue: (input: {
      readonly target: LiveActivities.TargetRow;
      readonly state: RelayAgentActivityState | null;
    }) => Effect.Effect<RelayDeliveryResult | null, WebPushDeliveryError>;
    readonly process: (
      body: unknown,
    ) => Effect.Effect<
      void,
      | WebPushDeliveryError
      | WebPushClient.WebPushClientError
      | PlatformError.PlatformError
      | Devices.WebPushTargetLookupPersistenceError
      | Devices.WebPushSubscriptionRemovalPersistenceError
      | AgentActivityRows.AgentActivityRowListPersistenceError
      | EnvironmentLinks.EnvironmentLinkLookupPersistenceError
      | EnvironmentLinks.EnvironmentLinkUserListPersistenceError
    >;
  }
>()("t3code-relay/agentActivity/WebPushDeliveries") {}

export const make = Effect.gen(function* () {
  const config = yield* RelayConfiguration.RelayConfiguration;
  const crypto = yield* Crypto.Crypto;
  const sender = yield* WebPushDeliveryQueueSender.WebPushDeliveryQueueSender;
  const client = yield* WebPushClient.WebPushClient;
  const devices = yield* Devices.Devices;
  const rows = yield* AgentActivityRows.AgentActivityRows;
  const links = yield* EnvironmentLinks.EnvironmentLinks;

  return WebPushDeliveries.of({
    enqueue: Effect.fn("relay.web_push.enqueue")(function* (input) {
      // Web push is opt-in per relay: without VAPID keys nothing is queued.
      if (!config.webPush) return null;
      if (input.target.platform !== "web" || !input.target.push_token || !input.state) {
        return null;
      }
      const now = yield* DateTime.now;
      // Only alerts are worth a push: every web push must show a notification.
      const preferences = Option.getOrNull(decodePreferences(input.target.preferences_json));
      if (!shouldAlertForActivity({ ...input.state, preferences, nowMs: now.epochMilliseconds })) {
        return null;
      }
      yield* sender
        .send({
          userId: input.target.user_id,
          deviceId: input.target.device_id,
          endpoint: input.target.push_token,
          state: input.state,
          queuedAt: now.epochMilliseconds,
        })
        .pipe(
          Effect.mapError((cause) => new WebPushDeliveryError({ operation: "enqueue", cause })),
        );
      return {
        deviceId: input.target.device_id,
        kind: "push_notification",
        ok: true,
        queued: true,
        apnsStatus: null,
        apnsReason: null,
        apnsId: null,
      };
    }),
    process: Effect.fn("relay.web_push.process")(function* (body) {
      const job = yield* decodeJob(body).pipe(
        Effect.mapError((cause) => new WebPushDeliveryError({ operation: "decode-job", cause })),
      );
      if (!config.webPush) return;
      const now = yield* DateTime.now;
      if (now.epochMilliseconds - job.queuedAt > MAX_QUEUE_AGE_MS) return;

      // Re-read everything when consuming: queued alerts must honor
      // unsubscribe, sign-out, muted environments and newer thread states.
      const target = yield* devices.findWebPushTarget({
        userId: job.userId,
        deviceId: job.deviceId,
      });
      if (!target || target.subscription.endpoint !== job.endpoint) return;
      const state = yield* rows.getForUserThread({
        userId: job.userId,
        environmentId: job.state.environmentId,
        threadId: job.state.threadId,
      });
      // A newer state for the thread has its own job.
      if (
        !state ||
        state.phase !== job.state.phase ||
        state.updatedAt !== job.state.updatedAt ||
        isExpiredAgentActivityState(state, now.epochMilliseconds)
      ) {
        return;
      }
      const link = yield* links.getForUser({
        userId: job.userId,
        environmentId: state.environmentId,
      });
      if (!link) return;
      const deliveryUsers = yield* links.listDeliveryUsersForEnvironment({
        environmentId: state.environmentId,
        environmentPublicKey: link.environmentPublicKey,
      });
      if (!deliveryUsers.some((user) => user.userId === job.userId && user.notificationsEnabled)) {
        return;
      }
      if (
        !shouldAlertForActivity({
          ...state,
          preferences: target.preferences,
          nowMs: now.epochMilliseconds,
        })
      ) {
        return;
      }

      const notification = notificationForActivity({
        ...state,
        status: statusForPhase(state.phase),
      });
      const tag = `${state.environmentId}:${state.threadId}`;
      const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(tag));
      const gone = yield* client
        .send({
          subscription: target.subscription,
          payload: encodeWebPushNotification({
            title: notification.title,
            body: notification.body,
            path: notification.deepLink,
            tag,
          }),
          ttlSeconds: WEB_PUSH_TTL_SECONDS,
          // Topics are at most 32 base64url characters.
          topic: Base64Url.encode(digest).slice(0, 32),
        })
        .pipe(
          Effect.map((outcome) => outcome.gone),
          Effect.catchIf(
            (error) => error.permanent,
            (error) =>
              Effect.logWarning("Web push service rejected a delivery; dropping it", {
                operation: error.operation,
                status: error.status,
              }).pipe(Effect.as(false)),
          ),
        );
      if (gone) {
        yield* devices.removeWebPushSubscription({
          userId: job.userId,
          deviceId: job.deviceId,
          endpoint: job.endpoint,
        });
      }
    }),
  });
});

export const layer = Layer.effect(WebPushDeliveries, make);
