import { afterEach, expect, it, vi } from "vite-plus/test";

import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    // app.config.ts copies this into process.env, where undefined would become "undefined".
    ...(process.env.T3CODE_IOS_TEAM_ID
      ? { T3CODE_IOS_TEAM_ID: process.env.T3CODE_IOS_TEAM_ID }
      : {}),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

// Up.computer: iOS carries its own identity; Android stays upstream's for now.
it.each([
  [undefined, "computer.up.upcomputer.mobile", "com.t3tools.t3code", "upcomputer", "Up.computer"],
  [
    "development",
    "computer.up.upcomputer.mobile.dev",
    "com.t3tools.t3code.dev",
    "upcomputer-dev",
    "Up.computer Dev",
  ],
  [
    "preview",
    "computer.up.upcomputer.mobile.preview",
    "com.t3tools.t3code.preview",
    "upcomputer-preview",
    "Up.computer Preview",
  ],
  [
    "production",
    "computer.up.upcomputer.mobile",
    "com.t3tools.t3code",
    "upcomputer",
    "Up.computer",
  ],
])(
  "uses the Up.computer iOS identity for APP_VARIANT=%j",
  async (value, identifier, androidPackage, scheme, name) => {
    const config = await loadConfig(value);
    expect(config.ios?.bundleIdentifier).toBe(identifier);
    expect(config.scheme).toBe(scheme);
    expect(config.name).toBe(name);
    expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
      `$(AppIdentifierPrefix)${identifier}`,
    ]);
    const pluginOptions = (name: string) =>
      (
        config.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === name) as
          | [string, Record<string, unknown>]
          | undefined
      )?.[1];
    expect(pluginOptions("expo-widgets")).toMatchObject({
      bundleIdentifier: `${identifier}.widgets`,
      groupIdentifier: `group.${identifier}`,
      enablePushNotifications: false,
    });
    expect(pluginOptions("expo-sharing")?.ios).toMatchObject({
      extensionBundleIdentifier: `${identifier}.sharing`,
      appGroupId: `group.${identifier}`,
    });
    expect(pluginOptions("@clerk/expo")).toMatchObject({ appleSignIn: false });
    // Universal links and passkeys wait for our domains' association files.
    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.updates).toEqual({ enabled: false });
    expect(config.extra?.agentAwarenessPushEnabled).toBe(false);
    expect(config.extra?.eas?.projectId).toBeUndefined();
    const { android, ...ios } = config;
    expect(JSON.stringify(ios)).not.toMatch(
      /t3\.codes|t3tools|pingdotgg|u\.expo\.dev|ARK85ZXQ4Z|T3 Code|\.icon"/,
    );
    expect(android?.package).toBe(androidPackage);
    expect(assetLinks.map((link) => link.target.package_name)).toContain(androidPackage);
  },
);

it("signs with the team from T3CODE_IOS_TEAM_ID and with no team otherwise", async () => {
  expect((await loadConfig("development")).ios?.appleTeamId).toBeUndefined();
  vi.stubEnv("T3CODE_IOS_TEAM_ID", "ABCDE12345");
  expect((await loadConfig("development")).ios?.appleTeamId).toBe("ABCDE12345");
});
