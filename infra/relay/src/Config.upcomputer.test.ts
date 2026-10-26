import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import {
  apnsEnabledConfig,
  legacyManagedEndpointCleanupModeConfig,
  legacyTunnelGraceMinutesConfig,
  managedEndpointCleanupModeConfig,
  webPushCredentialsConfig,
  webPushEnabledConfig,
} from "./Config.ts";

it.effect.each([
  { name: "missing", env: {}, expected: false },
  { name: "false", env: { APNS_ENABLED: "false" }, expected: false },
  { name: "true", env: { APNS_ENABLED: "true" }, expected: true },
] as const)("loads $name APNS_ENABLED as $expected", ({ env, expected }) =>
  Effect.gen(function* () {
    expect(yield* apnsEnabledConfig.parse(ConfigProvider.fromEnv({ env }))).toBe(expected);
  }),
);

it.effect.each([
  { name: "missing", env: {}, expected: false },
  { name: "true", env: { WEB_PUSH_ENABLED: "true" }, expected: true },
] as const)("loads $name WEB_PUSH_ENABLED as $expected", ({ env, expected }) =>
  Effect.gen(function* () {
    expect(yield* webPushEnabledConfig.parse(ConfigProvider.fromEnv({ env }))).toBe(expected);
  }),
);

const vapid = {
  WEB_PUSH_VAPID_PUBLIC_KEY:
    " BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8 ",
  WEB_PUSH_VAPID_PRIVATE_KEY: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  WEB_PUSH_SUBJECT: "mailto:push@up.computer",
};

it.effect("loads trimmed VAPID credentials", () =>
  Effect.gen(function* () {
    const credentials = yield* webPushCredentialsConfig.parse(
      ConfigProvider.fromEnv({ env: vapid }),
    );
    expect(credentials.publicKey).toBe(vapid.WEB_PUSH_VAPID_PUBLIC_KEY.trim());
    expect(Redacted.value(credentials.privateKey)).toBe(vapid.WEB_PUSH_VAPID_PRIVATE_KEY);
    expect(credentials.subject).toBe("mailto:push@up.computer");
  }),
);

it.effect.each([
  { name: "a short public key", env: { ...vapid, WEB_PUSH_VAPID_PUBLIC_KEY: "BP4z9KsN" } },
  { name: "a long private key", env: { ...vapid, WEB_PUSH_VAPID_PRIVATE_KEY: "a".repeat(64) } },
  { name: "an http subject", env: { ...vapid, WEB_PUSH_SUBJECT: "http://up.computer" } },
  {
    name: "a missing subject",
    env: {
      WEB_PUSH_VAPID_PUBLIC_KEY: vapid.WEB_PUSH_VAPID_PUBLIC_KEY,
      WEB_PUSH_VAPID_PRIVATE_KEY: vapid.WEB_PUSH_VAPID_PRIVATE_KEY,
    },
  },
])("rejects $name without echoing the private key", ({ env }) =>
  Effect.gen(function* () {
    const error = yield* webPushCredentialsConfig
      .parse(ConfigProvider.fromEnv({ env }))
      .pipe(Effect.flip);
    expect(String(error)).not.toContain(env.WEB_PUSH_VAPID_PRIVATE_KEY);
  }),
);
