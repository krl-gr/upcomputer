import type { RelayWebPushSubscription } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as RelayConfiguration from "../Config.ts";
import * as WebCrypto from "../WebCrypto.ts";
import {
  decodeBase64Url,
  encryptWebPushPayload,
  importVapidSigningKey,
  vapidAuthorization,
} from "./webPushCrypto.ts";

const WEB_PUSH_HTTP_TIMEOUT = "10 seconds";
// Push services cap VAPID tokens at 24 hours; stay well inside for clock skew.
const VAPID_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

export class WebPushClientError extends Schema.TaggedError<WebPushClientError>()(
  "WebPushClientError",
  {
    operation: Schema.Literals(["configuration", "encrypt", "authorize", "send"]),
    status: Schema.NullOr(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Web push ${this.operation} failed${this.status === null ? "" : ` (${this.status})`}.`;
  }

  /** Retrying cannot help: the subscription or the request itself is rejected. */
  get permanent(): boolean {
    if (this.operation === "encrypt") return true;
    return this.status !== null && this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export interface WebPushMessage {
  readonly subscription: RelayWebPushSubscription;
  readonly payload: Uint8Array;
  /** Seconds the push service keeps an undelivered message. */
  readonly ttlSeconds: number;
  /** Replaces an undelivered message with the same topic (RFC 8030 section 5.4). */
  readonly topic?: string;
}

export class WebPushClient extends Context.Service<
  WebPushClient,
  {
    /** `gone` means the push service no longer knows the subscription (404/410). */
    readonly send: (
      message: WebPushMessage,
    ) => Effect.Effect<{ readonly gone: boolean }, WebPushClientError>;
  }
>()("t3code-relay/agentActivity/WebPushClient") {}

export const make = Effect.gen(function* () {
  const config = yield* RelayConfiguration.RelayConfiguration;
  const { subtle } = yield* WebCrypto.WebCrypto;
  const client = yield* HttpClient.HttpClient;
  const credentials = config.webPush ?? null;
  const signingKey = yield* Effect.cached(
    credentials
      ? Effect.tryPromise({
          try: () =>
            importVapidSigningKey(subtle, {
              publicKey: credentials.publicKey,
              privateKey: Redacted.value(credentials.privateKey),
            }),
          catch: (cause) =>
            new WebPushClientError({ operation: "configuration", status: null, cause }),
        })
      : Effect.fail(new WebPushClientError({ operation: "configuration", status: null })),
  );

  return WebPushClient.of({
    send: Effect.fn("relay.web_push.send")(function* (message) {
      if (!credentials) {
        return yield* new WebPushClientError({ operation: "configuration", status: null });
      }
      const key = yield* signingKey;
      const userAgentPublicKey = decodeBase64Url(message.subscription.p256dh);
      const authSecret = decodeBase64Url(message.subscription.auth);
      const body = yield* Effect.tryPromise({
        try: async () => {
          if (!userAgentPublicKey || !authSecret) {
            throw new RangeError("Web push subscription keys are not base64url.");
          }
          return encryptWebPushPayload(subtle, {
            plaintext: message.payload,
            userAgentPublicKey,
            authSecret,
          });
        },
        catch: (cause) => new WebPushClientError({ operation: "encrypt", status: null, cause }),
      });
      const now = yield* DateTime.now;
      const authorization = yield* Effect.tryPromise({
        try: () =>
          vapidAuthorization(subtle, {
            signingKey: key,
            publicKey: credentials.publicKey,
            endpoint: message.subscription.endpoint,
            subject: credentials.subject,
            expiresAtSeconds:
              Math.floor(now.epochMilliseconds / 1000) + VAPID_TOKEN_LIFETIME_SECONDS,
          }),
        catch: (cause) => new WebPushClientError({ operation: "authorize", status: null, cause }),
      });
      const response = yield* client
        .execute(
          HttpClientRequest.post(message.subscription.endpoint).pipe(
            HttpClientRequest.setHeaders({
              authorization,
              "content-encoding": "aes128gcm",
              ttl: String(message.ttlSeconds),
              // Every message is a visible alert, so it may wake the device.
              urgency: "high",
              ...(message.topic ? { topic: message.topic } : {}),
            }),
            HttpClientRequest.bodyUint8Array(body, "application/octet-stream"),
          ),
        )
        .pipe(
          Effect.timeout(WEB_PUSH_HTTP_TIMEOUT),
          Effect.mapError(
            (cause) => new WebPushClientError({ operation: "send", status: null, cause }),
          ),
        );
      if (response.status >= 200 && response.status < 300) return { gone: false };
      if (response.status === 404 || response.status === 410) return { gone: true };
      return yield* new WebPushClientError({ operation: "send", status: response.status });
    }),
  });
});

export const layer = Layer.effect(WebPushClient, make);
