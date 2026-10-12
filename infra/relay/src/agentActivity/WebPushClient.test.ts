import { describe, expect, it } from "@effect/vitest";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as RelayConfiguration from "../Config.ts";
import * as WebCrypto from "../WebCrypto.ts";
import * as WebPushClient from "./WebPushClient.ts";

const { subtle } = globalThis.crypto;
const vapidKeys = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const vapidPublicKey = Base64Url.encode(
  new Uint8Array(await subtle.exportKey("raw", vapidKeys.publicKey)),
);
const userAgentKeys = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
  "deriveBits",
])) as CryptoKeyPair;

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

const config = {
  ...baseConfig,
  webPush: {
    publicKey: vapidPublicKey,
    privateKey: Redacted.make((await subtle.exportKey("jwk", vapidKeys.privateKey)).d!),
    subject: "mailto:push@up.computer",
  },
} satisfies RelayConfiguration.RelayConfiguration["Service"];

const message = {
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: Base64Url.encode(
      new Uint8Array(await subtle.exportKey("raw", userAgentKeys.publicKey)),
    ),
    auth: Base64Url.encode(new Uint8Array(16).fill(7)),
  },
  payload: new TextEncoder().encode('{"title":"Done"}'),
  ttlSeconds: 600,
  topic: "thread-topic",
};

function layerTest(
  configuration: RelayConfiguration.RelayConfiguration["Service"],
  status: number,
  requests: HttpClientRequest.HttpClientRequest[] = [],
) {
  const http = HttpClient.make((request) => {
    requests.push(request);
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })));
  });
  return WebPushClient.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RelayConfiguration.RelayConfiguration, configuration),
        Layer.succeed(WebCrypto.WebCrypto, { subtle }),
        Layer.succeed(HttpClient.HttpClient, http),
      ),
    ),
  );
}

describe("WebPushClient", () => {
  it.effect("posts an encrypted, VAPID-signed message with TTL and topic", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    return Effect.gen(function* () {
      const client = yield* WebPushClient.WebPushClient;
      expect(yield* client.send(message)).toEqual({ gone: false });
      const request = requests[0]!;
      expect(request.url).toBe(message.subscription.endpoint);
      expect(request.headers).toMatchObject({
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "600",
        urgency: "high",
        topic: "thread-topic",
      });
      expect(request.headers.authorization).toMatch(
        new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapidPublicKey}$`),
      );
      const body = request.body._tag === "Uint8Array" ? request.body.body : null;
      // Header (86 bytes) + payload + delimiter + GCM tag.
      expect(body?.length).toBe(86 + message.payload.length + 1 + 16);
    }).pipe(Effect.provide(layerTest(config, 201, requests)));
  });

  it.effect.each([404, 410])("reports a %i subscription as gone", (status) =>
    Effect.gen(function* () {
      const client = yield* WebPushClient.WebPushClient;
      expect(yield* client.send(message)).toEqual({ gone: true });
    }).pipe(Effect.provide(layerTest(config, status))),
  );

  it.effect.each([
    { status: 429, permanent: false },
    { status: 503, permanent: false },
    { status: 403, permanent: true },
    { status: 413, permanent: true },
  ])("fails a $status response (permanent: $permanent)", ({ status, permanent }) =>
    Effect.gen(function* () {
      const client = yield* WebPushClient.WebPushClient;
      const error = yield* client.send(message).pipe(Effect.flip);
      expect(error).toMatchObject({ operation: "send", status });
      expect(error.permanent).toBe(permanent);
    }).pipe(Effect.provide(layerTest(config, status))),
  );

  it.effect("sends nothing without VAPID credentials", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    return Effect.gen(function* () {
      const client = yield* WebPushClient.WebPushClient;
      const error = yield* client.send(message).pipe(Effect.flip);
      expect(error.operation).toBe("configuration");
      expect(requests).toHaveLength(0);
    }).pipe(Effect.provide(layerTest({ ...baseConfig, webPush: null }, 201, requests)));
  });
});
