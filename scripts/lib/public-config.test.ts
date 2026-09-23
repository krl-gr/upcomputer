// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv, resolvePublicConfig } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("does not project cloud configuration for an unconfigured clone", () => {
    const env = loadRepoEnv({ baseEnv: {}, repoRoot: makeTemporaryDirectory() });

    expect(env.UPCOMPUTER_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.UPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID).toBeUndefined();
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.UPCOMPUTER_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.VITE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.UPCOMPUTER_RELAY_URL).toBeUndefined();
    expect(env.VITE_UPCOMPUTER_RELAY_URL).toBeUndefined();
    expect(env.UPCOMPUTER_MOBILE_OTLP_TRACES_URL).toBeUndefined();
    expect(env.UPCOMPUTER_MOBILE_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.UPCOMPUTER_MOBILE_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_URL).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_URL).toBeUndefined();
    expect(env.UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_URL).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_TOKEN).toBeUndefined();
  });

  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "UPCOMPUTER_CLERK_PUBLISHABLE_KEY=pk_root\nUPCOMPUTER_CLERK_JWT_TEMPLATE=template_root\nUPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nUPCOMPUTER_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "UPCOMPUTER_CLERK_PUBLISHABLE_KEY=pk_local\nUPCOMPUTER_CLERK_JWT_TEMPLATE=template_local\nUPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nUPCOMPUTER_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).UPCOMPUTER_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          UPCOMPUTER_CLERK_PUBLISHABLE_KEY: "pk_ci",
          UPCOMPUTER_CLERK_JWT_TEMPLATE: "template_ci",
          UPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          UPCOMPUTER_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      UPCOMPUTER_CLERK_PUBLISHABLE_KEY: "pk_ci",
      UPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      UPCOMPUTER_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      UPCOMPUTER_RELAY_URL: "https://ci.example.test",
      VITE_UPCOMPUTER_RELAY_URL: "https://ci.example.test",
    });
  });

  it("ignores T3 configuration and does not emit its aliases", () => {
    expect(
      resolvePublicConfig({
        T3CODE_RELAY_URL: "https://old.example.test",
        VITE_T3CODE_RELAY_URL: "https://old.example.test",
      }).relayUrl,
    ).toBeUndefined();
    const env = loadRepoEnv({
      baseEnv: { UPCOMPUTER_RELAY_URL: "https://new.example.test" },
      repoRoot: makeTemporaryDirectory(),
    });
    expect(env.VITE_UPCOMPUTER_RELAY_URL).toBe("https://new.example.test");
    expect(env.VITE_T3CODE_RELAY_URL).toBeUndefined();
  });

  it("accepts legacy framework aliases as root overrides", () => {
    expect(
      resolvePublicConfig({
        VITE_CLERK_PUBLISHABLE_KEY: "pk_legacy",
        VITE_CLERK_JWT_TEMPLATE: "template_legacy",
        UPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_canonical",
        VITE_UPCOMPUTER_RELAY_URL: "https://legacy.example.test",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
        EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
      }),
    ).toEqual({
      clerkPublishableKey: "pk_legacy",
      clerkJwtTemplate: "template_legacy",
      clerkCliOAuthClientId: "oauth_canonical",
      relayUrl: "https://legacy.example.test",
      mobileOtlpTracesUrl: "https://api.axiom.co/v1/traces",
      mobileOtlpTracesDataset: "mobile-traces",
      mobileOtlpTracesToken: "mobile-token",
      relayClientOtlpTracesUrl: undefined,
      relayClientOtlpTracesDataset: undefined,
      relayClientOtlpTracesToken: undefined,
    });
  });

  it("projects canonical relay client tracing values to web build aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
          UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
          UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
        },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toEqual({
      UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
      UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
      VITE_RELAY_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      VITE_RELAY_OTLP_TRACES_DATASET: "relay-client-traces",
      VITE_RELAY_OTLP_TRACES_TOKEN: "relay-client-token",
    });
  });

  it("projects canonical mobile tracing values to Expo public aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          UPCOMPUTER_RELAY_URL: "https://relay.example.test",
          UPCOMPUTER_MOBILE_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
          UPCOMPUTER_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
          UPCOMPUTER_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
        },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toEqual({
      UPCOMPUTER_RELAY_URL: "https://relay.example.test",
      VITE_UPCOMPUTER_RELAY_URL: "https://relay.example.test",
      UPCOMPUTER_MOBILE_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      UPCOMPUTER_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
      UPCOMPUTER_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
      EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
      EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
    });
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
