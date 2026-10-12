import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as RelayConfiguration from "../Config.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as AgentActivityRows from "./AgentActivityRows.ts";
import * as Devices from "./Devices.ts";
import type * as LiveActivities from "./LiveActivities.ts";
import * as WebPushClient from "./WebPushClient.ts";
import * as WebPushDeliveries from "./WebPushDeliveries.ts";
import * as WebPushDeliveryQueueSender from "./WebPushDeliveryQueueSender.ts";
import { MAX_WEB_PUSH_PLAINTEXT_BYTES } from "./webPushCrypto.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const endpoint = "https://web.push.apple.com/subscription";
const state: RelayAgentActivityState = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  projectTitle: "Project",
  threadTitle: "Fix notifications",
  phase: "completed",
  headline: "Done",
  modelTitle: "Codex",
  updatedAt: "1970-01-01T00:00:00.000Z",
  deepLink: "/threads/env/thread",
};
const preferences = {
  notificationsEnabled: true,
  liveActivitiesEnabled: false,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};
const target: LiveActivities.TargetRow = {
  user_id: "user",
  device_id: "browser",
  platform: "web",
  ios_major_version: null,
  app_version: null,
  bundle_id: null,
  aps_environment: null,
  push_token: endpoint,
  push_to_start_token: null,
  preferences_json: encodeJson(preferences),
  activity_push_token: null,
  remote_start_queued_at: null,
  remote_started_at: null,
  ended_at: null,
  last_aggregate_json: null,
  last_live_activity_delivery_at: null,
};
const baseConfig = {
  relayIssuer: "https://relay.test",
  apns: null,
  clerkSecretKey: Redacted.make("unused"),
  clerkPublishableKey: "unused",
  clerkJwtAudience: "unused",
  apnsDeliveryJobSigningSecret: Redacted.make("unused"),
  cloudMintPrivateKey: Redacted.make("unused"),
  cloudMintPublicKey: "unused",
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
} satisfies RelayConfiguration.RelayConfiguration["Service"];
const enabledConfig = {
  ...baseConfig,
  webPush: {
    publicKey: "public",
    privateKey: Redacted.make("private"),
    subject: "mailto:push@up.computer",
  },
} satisfies RelayConfiguration.RelayConfiguration["Service"];

function harness(configuration: RelayConfiguration.RelayConfiguration["Service"] = enabledConfig) {
  const queued: WebPushDeliveries.WebPushDeliveryJob[] = [];
  const sent: WebPushClient.WebPushMessage[] = [];
  const removed: Array<Parameters<Devices.Devices["Service"]["removeWebPushSubscription"]>[0]> = [];
  const current = {
    endpoint: endpoint as string | null,
    state: state as RelayAgentActivityState | null,
    linked: true,
    notificationsEnabled: true,
    outcome: { gone: false } as { gone: boolean } | WebPushClient.WebPushClientError,
  };
  const layerServices = Layer.mergeAll(
    NodeCryptoLayer.layer,
    Layer.succeed(RelayConfiguration.RelayConfiguration, configuration),
    Layer.succeed(WebPushDeliveryQueueSender.WebPushDeliveryQueueSender, {
      send: (job) => Effect.sync(() => void queued.push(job)),
    }),
    Layer.succeed(WebPushClient.WebPushClient, {
      send: (message) =>
        Effect.suspend(() => {
          sent.push(message);
          return "gone" in current.outcome
            ? Effect.succeed(current.outcome)
            : Effect.fail(current.outcome);
        }),
    }),
    Layer.succeed(Devices.Devices, {
      register: () => Effect.void,
      unregister: () => Effect.void,
      listForUser: () => Effect.succeed([]),
      findWebPushTarget: () =>
        Effect.sync(() =>
          current.endpoint
            ? {
                subscription: { endpoint: current.endpoint, p256dh: "key", auth: "secret" },
                preferences,
              }
            : null,
        ),
      removeWebPushSubscription: (input) => Effect.sync(() => void removed.push(input)),
    }),
    Layer.succeed(AgentActivityRows.AgentActivityRows, {
      upsert: () => Effect.void,
      remove: () => Effect.void,
      pruneTerminal: () => Effect.void,
      listForUser: () => Effect.succeed([]),
      getForUserThread: () => Effect.sync(() => current.state),
    }),
    Layer.succeed(EnvironmentLinks.EnvironmentLinks, {
      upsert: () => Effect.void,
      listDeliveryUsersForEnvironment: () =>
        Effect.sync(() => [
          {
            userId: "user",
            notificationsEnabled: current.notificationsEnabled,
            liveActivitiesEnabled: false,
          },
        ]),
      listForUser: () => Effect.succeed([]),
      findActiveManagedForEnvironment: () => Effect.succeed([]),
      setHoldWebhooksWhileOffline: () => Effect.void,
      revokeForUser: () => Effect.succeed(false),
      getForUser: (input) =>
        Effect.sync(() =>
          current.linked
            ? {
                environmentId: EnvironmentId.make(input.environmentId),
                label: "Desktop",
                environmentPublicKey: "key",
                linkedAt: state.updatedAt,
                endpoint: {
                  httpBaseUrl: "https://env.test",
                  wsBaseUrl: "wss://env.test",
                  providerKind: "manual",
                },
              }
            : null,
        ),
    }),
  );
  return {
    queued,
    sent,
    removed,
    current,
    layer: WebPushDeliveries.layer.pipe(Layer.provide(layerServices)),
    job: {
      userId: "user",
      deviceId: "browser",
      endpoint,
      state,
      queuedAt: 0,
    } satisfies WebPushDeliveries.WebPushDeliveryJob,
  };
}

describe("web push enqueue", () => {
  it.effect("queues alerts for web devices and nothing for running work or mobile devices", () => {
    const h = harness();
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      expect(yield* deliveries.enqueue({ target, state })).toMatchObject({
        deviceId: "browser",
        kind: "push_notification",
        queued: true,
      });
      expect(yield* deliveries.enqueue({ target, state: { ...state, phase: "running" } })).toBe(
        null,
      );
      expect(yield* deliveries.enqueue({ target, state: null })).toBe(null);
      expect(yield* deliveries.enqueue({ target: { ...target, platform: "android" }, state })).toBe(
        null,
      );
      expect(
        yield* deliveries.enqueue({
          target: {
            ...target,
            preferences_json: encodeJson({ ...preferences, notifyOnCompletion: false }),
          },
          state,
        }),
      ).toBe(null);
      expect(h.queued).toEqual([h.job]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("queues and sends nothing while web push is off", () => {
    const h = harness(baseConfig);
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      expect(yield* deliveries.enqueue({ target, state })).toBe(null);
      yield* deliveries.process(h.job);
      expect(h.queued).toEqual([]);
      expect(h.sent).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });
});

describe("web push processing", () => {
  it.effect("sends the thread alert with its tag, path, TTL and topic", () => {
    const h = harness();
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      yield* deliveries.process(h.job);
      expect(h.sent).toHaveLength(1);
      const message = h.sent[0]!;
      expect(message.subscription.endpoint).toBe(endpoint);
      expect(message.ttlSeconds).toBe(WebPushDeliveries.WEB_PUSH_TTL_SECONDS);
      expect(message.topic).toMatch(/^[\w-]{32}$/);
      expect(JSON.parse(new TextDecoder().decode(message.payload))).toEqual({
        title: "Fix notifications",
        body: "Done: Project",
        path: "/threads/env/thread",
        tag: "env:thread",
      });
      expect(h.removed).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("removes a subscription the push service reports gone", () => {
    const h = harness();
    h.current.outcome = { gone: true };
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      yield* deliveries.process(h.job);
      expect(h.removed).toEqual([{ userId: "user", deviceId: "browser", endpoint }]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect.each([
    { name: "a superseded thread state", change: { state: { ...state, phase: "running" } } },
    { name: "a deleted thread state", change: { state: null } },
    { name: "a rotated subscription", change: { endpoint: "https://push.test/other" } },
    { name: "an unsubscribed device", change: { endpoint: null } },
    { name: "a muted environment", change: { notificationsEnabled: false } },
    { name: "an unlinked environment", change: { linked: false } },
  ] as const)("sends nothing for $name", ({ change }) => {
    const h = harness();
    Object.assign(h.current, change);
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      yield* deliveries.process(h.job);
      expect(h.sent).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("drops a job that waited too long in the queue", () => {
    const h = harness();
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      yield* deliveries.process({ ...h.job, queuedAt: -10 * 60_000 });
      expect(h.sent).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("drops permanent rejections and retries transient failures", () => {
    const h = harness();
    return Effect.gen(function* () {
      const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
      h.current.outcome = new WebPushClient.WebPushClientError({ operation: "send", status: 403 });
      yield* deliveries.process(h.job);
      h.current.outcome = new WebPushClient.WebPushClientError({ operation: "send", status: 503 });
      expect(yield* deliveries.process(h.job).pipe(Effect.flip)).toMatchObject({
        _tag: "WebPushClientError",
        status: 503,
      });
      expect(h.removed).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  });
});

describe("web push payload", () => {
  it("shortens oversized text to fit one push message", () => {
    const encoded = WebPushDeliveries.encodeWebPushNotification({
      title: "т".repeat(3000),
      body: "😀".repeat(3000),
      path: "/threads/env/thread",
      tag: "env:thread",
    });
    expect(encoded.length).toBeLessThanOrEqual(MAX_WEB_PUSH_PLAINTEXT_BYTES);
    const decoded = JSON.parse(new TextDecoder().decode(encoded));
    expect(decoded).toMatchObject({ path: "/threads/env/thread", tag: "env:thread" });
    expect(decoded.body.endsWith("…")).toBe(true);
  });
});
