import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { decodeBase64Url, isP256PublicKey } from "./agentActivity/webPushCrypto.ts";

export const ApnsEnvironment = Schema.Literals(["sandbox", "production"]);
export type ApnsEnvironment = typeof ApnsEnvironment.Type;

/**
 * APNs delivery needs Apple credentials (`APNS_*`), so it stays off until
 * APNS_ENABLED=true. While off, the relay reads no `APNS_*` value and enqueues
 * no APNs jobs.
 */
export const apnsEnabledConfig = Config.Boolean("APNS_ENABLED").pipe(Config.withDefault(false));

/**
 * Web push (browsers and home-screen web apps) needs a VAPID key pair, so it
 * stays off until WEB_PUSH_ENABLED=true. While off, the relay reads no
 * `WEB_PUSH_*` value and enqueues no web push jobs.
 */
export const webPushEnabledConfig = Config.Boolean("WEB_PUSH_ENABLED").pipe(
  Config.withDefault(false),
);

export interface WebPushCredentials {
  /** base64url uncompressed P-256 point, the browser's `applicationServerKey`. */
  readonly publicKey: string;
  /** base64url P-256 private scalar. */
  readonly privateKey: Redacted.Redacted<string>;
  /** VAPID contact: a mailto: or https: URL. */
  readonly subject: string;
}

// Messages name the variable but never echo its value: the private key is a secret.
const invalidConfig = (name: string, expected: string) =>
  new Config.ConfigError(
    new ConfigProvider.SourceError({ message: `${name} must be ${expected}.` }),
  );

export const webPushCredentialsConfig: Config.Config<WebPushCredentials> = Config.all({
  publicKey: Config.String("WEB_PUSH_VAPID_PUBLIC_KEY").pipe(
    Config.map((value) => value.trim()),
    Config.mapEffect((value) => {
      const bytes = decodeBase64Url(value);
      return bytes && isP256PublicKey(bytes)
        ? Effect.succeed(value)
        : Effect.fail(
            invalidConfig("WEB_PUSH_VAPID_PUBLIC_KEY", "a base64url uncompressed P-256 public key"),
          );
    }),
  ),
  privateKey: Config.Redacted("WEB_PUSH_VAPID_PRIVATE_KEY").pipe(
    Config.mapEffect((value) =>
      decodeBase64Url(Redacted.value(value))?.length === 32
        ? Effect.succeed(Redacted.make(Redacted.value(value).trim()))
        : Effect.fail(invalidConfig("WEB_PUSH_VAPID_PRIVATE_KEY", "a base64url P-256 private key")),
    ),
  ),
  subject: Config.String("WEB_PUSH_SUBJECT").pipe(
    Config.map((value) => value.trim()),
    Config.mapEffect((value) =>
      /^(mailto:\S+|https:\/\/\S+)$/.test(value)
        ? Effect.succeed(value)
        : Effect.fail(invalidConfig("WEB_PUSH_SUBJECT", "a mailto: or https: URL")),
    ),
  ),
});

export const ManagedEndpointCleanupMode = Schema.Literals(["off", "dry-run", "enabled"]);
export type ManagedEndpointCleanupMode = typeof ManagedEndpointCleanupMode.Type;
const decodeManagedEndpointCleanupMode = Schema.decodeUnknownEffect(ManagedEndpointCleanupMode);

const RELAY_TUNNEL_CLEANUP_MODE = "RELAY_TUNNEL_CLEANUP_MODE";
const RELAY_LEGACY_TUNNEL_CLEANUP_MODE = "RELAY_LEGACY_TUNNEL_CLEANUP_MODE";

const cleanupModeConfig = (name: string) =>
  Config.String(name).pipe(
    Config.withDefault("off"),
    Config.map((value) => value.trim() || "off"),
    Config.mapEffect((value) =>
      decodeManagedEndpointCleanupMode(value).pipe(
        Effect.mapError((error) => new Config.ConfigError(error)),
      ),
    ),
  );

export const managedEndpointCleanupModeConfig = cleanupModeConfig(RELAY_TUNNEL_CLEANUP_MODE);
export const legacyManagedEndpointCleanupModeConfig = cleanupModeConfig(
  RELAY_LEGACY_TUNNEL_CLEANUP_MODE,
);

const RELAY_LEGACY_TUNNEL_GRACE_MINUTES = "RELAY_LEGACY_TUNNEL_GRACE_MINUTES";

export const legacyTunnelGraceMinutesConfig = Config.option(
  Config.schema(
    Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
    RELAY_LEGACY_TUNNEL_GRACE_MINUTES,
  ),
);

export interface ApnsCredentials {
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: Redacted.Redacted<string>;
  readonly bundleId: string;
  readonly environment: ApnsEnvironment;
}

export interface T3ChatSettings {
  readonly baseUrl: string;
  // Shared with T3 Chat: signs link tokens and authenticates relay calls.
  readonly linkSecret: Redacted.Redacted<string>;
}

export class RelayConfiguration extends Context.Service<
  RelayConfiguration,
  {
    readonly relayIssuer: string;
    readonly apns: ApnsCredentials | null;
    readonly fcmServiceAccount?: Redacted.Redacted<string>;
    /** Null while WEB_PUSH_ENABLED is off. */
    readonly webPush?: WebPushCredentials | null;
    readonly clerkSecretKey: Redacted.Redacted<string>;
    readonly clerkPublishableKey: string;
    readonly clerkJwtAudience: string;
    readonly apnsDeliveryJobSigningSecret: Redacted.Redacted<string>;
    readonly cloudMintPrivateKey: Redacted.Redacted<string>;
    readonly cloudMintPublicKey: string;
    readonly managedEndpointBaseDomain: string | undefined;
    readonly managedEndpointNamespace: string | undefined;
    readonly managedEndpointCleanupMode?: ManagedEndpointCleanupMode;
    readonly legacyManagedEndpointCleanupMode?: ManagedEndpointCleanupMode;
    readonly legacyTunnelGraceMinutes?: number;
    readonly t3Chat?: T3ChatSettings;
  }
>()("t3code-relay/Config/RelayConfiguration") {}

export const layer = (configuration: RelayConfiguration["Service"]) =>
  Layer.succeed(RelayConfiguration, RelayConfiguration.of(configuration));
