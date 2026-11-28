import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    // app.config.ts copies this into process.env, where undefined would become "undefined".
    ...(process.env.T3CODE_IOS_TEAM_ID
      ? { T3CODE_IOS_TEAM_ID: process.env.T3CODE_IOS_TEAM_ID }
      : {}),
    ...(process.env.T3CODE_ANDROID_GOOGLE_SERVICES_FILE
      ? { T3CODE_ANDROID_GOOGLE_SERVICES_FILE: process.env.T3CODE_ANDROID_GOOGLE_SERVICES_FILE }
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

// iOS and Android both carry Up.computer's identity; the Android package matches the iOS bundle id.
it.each([
  [undefined, "computer.up.upcomputer.mobile", "upcomputer", "Up.computer"],
  ["development", "computer.up.upcomputer.mobile.dev", "upcomputer-dev", "Up.computer Dev"],
  ["preview", "computer.up.upcomputer.mobile.preview", "upcomputer-preview", "Up.computer Preview"],
  ["production", "computer.up.upcomputer.mobile", "upcomputer", "Up.computer"],
])("uses the Up.computer identity for APP_VARIANT=%j", async (value, identifier, scheme, name) => {
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
  expect(pluginOptions("expo-secure-store")?.faceIDPermission).toMatch(/^Allow Up\.computer /);
  // Universal links and passkeys wait for our domains' association files.
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.updates).toEqual({ enabled: false });
  expect(config.extra?.agentAwarenessPushEnabled).toBe(false);
  expect(config.extra?.eas?.projectId).toBeUndefined();
  expect(config.android?.package).toBe(identifier);
  // App links wait for our domain's assetlinks.json.
  expect(config.android?.intentFilters).toBeUndefined();
  expect(config.android?.adaptiveIcon).toMatchObject({
    foregroundImage: "./assets/upcomputer/android-icon-foreground.png",
    monochromeImage: "./assets/upcomputer/android-icon-monochrome.png",
  });
  expect(pluginOptions("expo-notifications")?.icon).toBe(
    "./assets/upcomputer/android-notification-icon.png",
  );
  expect(pluginOptions("expo-splash-screen")?.android).toMatchObject({
    image: "./assets/upcomputer/android-splash-icon.png",
  });
  // Upstream's artwork lives in assets/android-*; ours in assets/upcomputer/.
  expect(JSON.stringify(config)).not.toMatch(
    /t3\.codes|t3tools|pingdotgg|u\.expo\.dev|ARK85ZXQ4Z|T3 Code|\.icon"|assets\/android-/,
  );
});

it("leaves upstream's Firebase file out of the Android build", async () => {
  vi.stubEnv("T3CODE_ANDROID_GOOGLE_SERVICES_FILE", "./google-services.json");
  expect((await loadConfig("production")).android?.googleServicesFile).toBeUndefined();
});

it("signs with the team from T3CODE_IOS_TEAM_ID and with no team otherwise", async () => {
  expect((await loadConfig("development")).ios?.appleTeamId).toBeUndefined();
  vi.stubEnv("T3CODE_IOS_TEAM_ID", "ABCDE12345");
  expect((await loadConfig("development")).ios?.appleTeamId).toBe("ABCDE12345");
});
