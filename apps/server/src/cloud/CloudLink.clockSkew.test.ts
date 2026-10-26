// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no generateKeyPairSync.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentMintResponseProofPayload,
  RelayManagedEndpointRecoveryProofPayload,
  RelayManagedEndpointRecoveryRegistrationRequest,
} from "@t3tools/contracts/relay";
import {
  decodeRelayJwt,
  RELAY_LINK_PROOF_TYP,
  RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
  RELAY_MINT_REQUEST_TYP,
  RELAY_MINT_RESPONSE_TYP,
  signRelayJwt,
  verifyRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse, HttpServer, HttpServerRequest } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfigModule from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import * as CloudLink from "./CloudLink.ts";
import * as ConnectReachability from "./ConnectReachability.ts";
import {
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_LINK_REVOKED,
  CLOUD_LINKED_USER_ID,
  CLOUD_MINT_PUBLIC_KEY,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "./config.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "./environmentKeys.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";
import { makeRelayClock, RelayClock } from "./RelayClock.ts";

const RELAY_ISSUER = "https://relay.example.test";
const ENVIRONMENT_ID = EnvironmentId.make("env_123");
const RELAY_NOW = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const relayKeys = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});

const SKEWS = [
  { name: "10 minutes behind", minutes: -10 },
  { name: "10 minutes ahead", minutes: 10 },
] as const;

const unused = () => Effect.die("unused");
const decodeRecoveryRegistration = Schema.decodeUnknownSync(
  Schema.fromJsonString(RelayManagedEndpointRecoveryRegistrationRequest),
);

const relayNowSeconds = (elapsed: Duration.Duration = Duration.zero) =>
  Math.floor((RELAY_NOW.epochMilliseconds + Duration.toMillis(elapsed)) / 1_000);

/** The relay's own checks: the explicit expiry check, then signature and iat. */
const relayAccepts = <A>(input: {
  readonly token: string;
  readonly typ: string;
  readonly publicKey: string;
  readonly schema: Schema.Decoder<A>;
}) =>
  Effect.gen(function* () {
    const now = relayNowSeconds(Duration.seconds(1));
    const candidate = decodeRelayJwt(input.token);
    if (typeof candidate.exp !== "number" || candidate.exp <= now) return false;
    return yield* verifyRelayJwt({
      publicKey: input.publicKey,
      token: input.token,
      typ: input.typ,
      issuer: `t3-env:${ENVIRONMENT_ID}`,
      audience: RELAY_ISSUER,
      nowEpochSeconds: now,
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(input.schema)),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  });

function memorySecrets(initial: ReadonlyArray<readonly [string, string]>) {
  const values = new Map<string, Uint8Array>(
    initial.map(([name, value]) => [name, new TextEncoder().encode(value)] as const),
  );
  const store: ServerSecretStore.ServerSecretStore["Service"] = {
    get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: unused,
    remove: (name) => Effect.sync(() => void values.delete(name)),
  };
  return { store, values };
}

const provideCloudLink =
  (input: {
    readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
    readonly relay?: (request: { readonly body: string }) => Effect.Effect<Response>;
    readonly environmentAuth?: Partial<EnvironmentAuth.EnvironmentAuth["Service"]>;
  }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(CloudLink.layer),
      Effect.provideService(RelayClock, makeRelayClock()),
      Effect.provideService(
        HttpServer.HttpServer,
        HttpServer.HttpServer.of({
          address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 3773),
          serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
        }),
      ),
      Effect.provideService(ServerSecretStore.ServerSecretStore, input.secrets),
      Effect.provideService(
        AgentAwarenessRelay.AgentAwarenessRelay,
        AgentAwarenessRelay.AgentAwarenessRelay.of({
          publishThread: () => Effect.void,
          drain: Effect.void,
          requestCatchUp: () => Effect.void,
          start: () => Effect.void,
        }),
      ),
      Effect.provideService(
        ServerEnvironment.ServerEnvironment,
        ServerEnvironment.ServerEnvironment.of({
          getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
          getDescriptor: Effect.succeed({
            environmentId: ENVIRONMENT_ID,
            label: "Skewed Clock Environment",
            platform: { os: "windows", arch: "x64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          }),
        }),
      ),
      Effect.provideService(
        ManagedEndpointRuntime.CloudManagedEndpointRuntime,
        ManagedEndpointRuntime.CloudManagedEndpointRuntime.of({
          applyConfig: () =>
            Effect.succeed({ status: "running", providerKind: "cloudflare_tunnel", pid: 1 }),
          recoveryRequests: Stream.empty,
          requestRecovery: () => Effect.void,
          tunnelConnected: Stream.empty,
          inspectConnector: Effect.succeed(null),
          readinessChanged: Stream.empty,
          withLinkStateLock: (effect) => effect,
        }),
      ),
      Effect.provideService(
        ConnectReachability.ConnectReachability,
        ConnectReachability.ConnectReachability.of({
          check: Effect.die("unused"),
          latest: Effect.succeedNone,
        }),
      ),
      Effect.provideService(
        EnvironmentAuth.EnvironmentAuth,
        EnvironmentAuth.EnvironmentAuth.of(
          (input.environmentAuth ?? {}) as EnvironmentAuth.EnvironmentAuth["Service"],
        ),
      ),
      Effect.provideService(
        CliTokenManager.CloudCliTokenManager,
        CliTokenManager.CloudCliTokenManager.of({
          get: unused(),
          getExisting: Effect.succeedNone,
          hasCredential: unused(),
          store: unused,
          clear: unused(),
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          (input.relay ?? (() => Effect.succeed(Response.json({}))))({
            body:
              request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
          }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response))),
        ),
      ),
      Effect.provide(
        ServerConfigModule.layerTest("/", { prefix: "t3-cloud-clock-skew-test-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    );

const setLocalClock = (skewMinutes: number) =>
  TestClock.setTime(RELAY_NOW.epochMilliseconds + skewMinutes * 60_000);

describe("relay proofs on a computer with a skewed clock", () => {
  it.effect.each(SKEWS)("signs a link proof the relay accepts when the clock is $name", (skew) => {
    const { store } = memorySecrets([]);
    return Effect.gen(function* () {
      yield* setLocalClock(skew.minutes);
      // The relay issued this challenge in its own time, moments ago.
      const challenge = yield* signRelayJwt({
        privateKey: relayKeys.privateKey,
        typ: "t3-link-challenge+jwt",
        payload: {
          iss: RELAY_ISSUER,
          aud: RELAY_ISSUER,
          sub: "user-123",
          jti: "challenge-jti",
          iat: relayNowSeconds(),
          exp: relayNowSeconds(Duration.minutes(5)),
        },
      });
      const link = yield* CloudLink.CloudLink;
      const proof = yield* link
        .linkProof(
          {
            challenge,
            relayIssuer: RELAY_ISSUER,
            endpoint: {
              httpBaseUrl: "http://127.0.0.1:3773",
              wsBaseUrl: "ws://127.0.0.1:3773",
              providerKind: "manual",
            },
            origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
          },
          HttpServerRequest.fromWeb(
            new Request("http://127.0.0.1:3773/api/connect/link-proof", { method: "POST" }),
          ),
        )
        .pipe(
          Effect.provideService(EnvironmentAuthenticatedPrincipal, {
            sessionId: AuthSessionId.make("skewed-clock-session"),
            subject: "skewed-clock-session",
            method: "browser-session-cookie",
            scopes: new Set([]),
          }),
        );
      const claims = decodeRelayJwt(proof);
      expect(claims.iat).toBe(relayNowSeconds());
      expect(Number(claims.exp) - Number(claims.iat)).toBe(5 * 60);
      expect(
        yield* relayAccepts({
          token: proof,
          typ: RELAY_LINK_PROOF_TYP,
          publicKey: String(claims.environmentPublicKey),
          schema: RelayEnvironmentLinkProofPayload,
        }),
      ).toBe(true);
    }).pipe(provideCloudLink({ secrets: store }));
  });

  it.effect.each(SKEWS)(
    "re-signs a tunnel registration the relay rejected for the clock when it is $name",
    (skew) => {
      const { store, values } = memorySecrets([
        [
          CLOUD_ENDPOINT_RUNTIME_CONFIG,
          '{"providerKind":"cloudflare_tunnel","connectorToken":"token","tunnelId":"tunnel-1"}',
        ],
        [RELAY_URL_SECRET, RELAY_ISSUER],
        [CLOUD_LINKED_USER_ID, "user-123"],
        [RELAY_ENVIRONMENT_CREDENTIAL_SECRET, "environment-credential"],
      ]);
      let environmentPublicKey = "";
      const verdicts: Array<boolean> = [];
      return Effect.gen(function* () {
        yield* setLocalClock(skew.minutes);
        const link = yield* CloudLink.CloudLink;
        environmentPublicKey = (yield* getOrCreateEnvironmentKeyPairFromSecretStore(store))
          .publicKey;
        expect(yield* link.registerManagedTunnelRecovery("http://127.0.0.1:3773")).toMatchObject({
          status: "ready",
        });
        expect(verdicts).toEqual([false, true]);
        expect(values.has(CLOUD_LINK_REVOKED)).toBe(false);
      }).pipe(
        provideCloudLink({
          secrets: store,
          relay: ({ body }) =>
            Effect.gen(function* () {
              const request = decodeRecoveryRegistration(body);
              const accepted = yield* relayAccepts({
                token: request.proof,
                typ: RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
                publicKey: environmentPublicKey,
                schema: RelayManagedEndpointRecoveryProofPayload,
              });
              verdicts.push(accepted);
              const headers = { date: DateTime.toDate(RELAY_NOW).toUTCString() };
              return accepted
                ? Response.json({ status: "ready" }, { headers })
                : Response.json(
                    {
                      _tag: "RelayAuthInvalidError",
                      code: "auth_invalid",
                      reason: "not_authorized",
                      traceId: "trace-skewed",
                    },
                    { status: 401, headers },
                  );
            }),
        }),
      );
    },
  );

  it.effect.each(SKEWS)(
    "accepts a relay mint request and answers in relay time when the clock is $name",
    (skew) => {
      const { store } = memorySecrets([
        [CLOUD_MINT_PUBLIC_KEY, relayKeys.publicKey],
        [RELAY_ISSUER_SECRET, RELAY_ISSUER],
        [CLOUD_LINKED_USER_ID, "user-123"],
      ]);
      return Effect.gen(function* () {
        yield* setLocalClock(skew.minutes);
        // Any earlier relay response has told this server the relay's time.
        yield* (yield* RelayClock).observe(RELAY_NOW);
        const requestProof = yield* signRelayJwt({
          privateKey: relayKeys.privateKey,
          typ: RELAY_MINT_REQUEST_TYP,
          payload: {
            iss: RELAY_ISSUER,
            aud: `t3-env:${ENVIRONMENT_ID}`,
            sub: "user-123",
            jti: "mint-jti",
            iat: relayNowSeconds(),
            exp: relayNowSeconds(Duration.minutes(1)),
            environmentId: ENVIRONMENT_ID,
            clientProofKeyThumbprint: "client-jkt",
            cnf: { jkt: "client-jkt" },
            nonce: "mint-nonce",
            scope: ["environment:connect"],
          },
        });
        const link = yield* CloudLink.CloudLink;
        const response = yield* link.mintCredential({ proof: requestProof });
        const claims = decodeRelayJwt(response.proof);
        expect(claims.iat).toBe(relayNowSeconds());
        expect(Math.floor(Date.parse(response.expiresAt) / 1_000)).toBe(claims.exp);
        expect(
          yield* relayAccepts({
            token: response.proof,
            typ: RELAY_MINT_RESPONSE_TYP,
            publicKey: (yield* getOrCreateEnvironmentKeyPairFromSecretStore(store)).publicKey,
            schema: RelayEnvironmentMintResponseProofPayload,
          }),
        ).toBe(true);
      }).pipe(
        provideCloudLink({
          secrets: store,
          environmentAuth: {
            createPairingLink: (options) =>
              Effect.gen(function* () {
                const createdAt = yield* DateTime.now;
                return {
                  id: "pairing-1",
                  credential: "pairing-credential",
                  scopes: options?.scopes ?? [],
                  subject: options?.subject ?? "cloud-connect",
                  createdAt,
                  expiresAt: DateTime.addDuration(createdAt, options?.ttl ?? Duration.minutes(2)),
                };
              }),
          },
        }),
      );
    },
  );
});
