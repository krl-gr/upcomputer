import type { ExpoConfig } from "expo/config";
import { UPCOMPUTER_PROTOCOL_SCHEME } from "@t3tools/shared/upcomputerIdentity";

import { rebrandLine } from "../../scripts/lib/branding.ts";

/**
 * Up.computer's identity on top of upstream's finished Expo config, so
 * app.config.ts keeps upstream's text. iOS only: Android stays as upstream
 * ships it. See docs/branding.md.
 */

type AppVariant = "development" | "preview" | "production";

const UPSTREAM_BUNDLE_IDENTIFIER = "com.t3tools.t3code";
// Proposed, not confirmed: an App Store or TestFlight record fixes it for good.
// Kept apart from the desktop's computer.up.upcomputer so an iPhone app running
// on a Mac never shares the desktop app's bundle id, keychain or URL scheme.
export const UPCOMPUTER_MOBILE_BUNDLE_IDENTIFIER = "computer.up.upcomputer.mobile";

const SCHEMES: Record<AppVariant, string> = {
  development: `${UPCOMPUTER_PROTOCOL_SCHEME}-dev`,
  preview: `${UPCOMPUTER_PROTOCOL_SCHEME}-preview`,
  production: UPCOMPUTER_PROTOCOL_SCHEME,
};

function rebrand(value: unknown): unknown {
  if (typeof value === "string") {
    return rebrandLine(value).replaceAll(
      UPSTREAM_BUNDLE_IDENTIFIER,
      UPCOMPUTER_MOBILE_BUNDLE_IDENTIFIER,
    );
  }
  if (Array.isArray(value)) return value.map(rebrand);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebrand(item)]));
  }
  return value;
}

type Plugin = NonNullable<ExpoConfig["plugins"]>[number];

// Our Clerk instance has no Apple sign-in, and our relay sends no APNs pushes yet.
// Secure store's default Face ID text names the Xcode target, "Upcomputer".
const PLUGIN_OPTIONS: Record<string, Record<string, unknown>> = {
  "@clerk/expo": { appleSignIn: false },
  "expo-secure-store": {
    faceIDPermission: "Allow Up.computer to access your Face ID biometric data.",
  },
  "expo-widgets": { enablePushNotifications: false },
};

function withPluginOptions(plugin: Plugin): Plugin {
  const [name, options] = (Array.isArray(plugin) ? plugin : [plugin]) as [
    string,
    Record<string, unknown> | undefined,
  ];
  const overrides = PLUGIN_OPTIONS[name];
  return overrides ? [name, { ...options, ...overrides }] : plugin;
}

export function applyUpcomputerAppConfig(
  config: ExpoConfig,
  variant: AppVariant,
  env: Readonly<Record<string, string | undefined>>,
): ExpoConfig {
  const { android, owner: _owner, ...upstream } = config;
  const branded = rebrand(upstream) as Omit<ExpoConfig, "android" | "owner">;
  // Universal links and passkeys need our domains' association files (later phase).
  // The upstream Icon Composer projects carry the T3 mark; the PNG icon applies.
  const {
    associatedDomains: _associatedDomains,
    appleTeamId: _appleTeamId,
    icon: _icon,
    ...ios
  } = branded.ios ?? {};
  // The EAS project and its update channel belong to upstream.
  const { projectId: _projectId, ...eas } = (branded.extra?.eas ?? {}) as Record<string, unknown>;
  const appleTeamId = env.T3CODE_IOS_TEAM_ID?.trim();

  return {
    ...branded,
    scheme: SCHEMES[variant],
    updates: { enabled: false },
    ios: { ...ios, ...(appleTeamId ? { appleTeamId } : {}) },
    ...(android ? { android } : {}),
    plugins: branded.plugins?.map(withPluginOptions),
    extra: { ...branded.extra, eas, agentAwarenessPushEnabled: false },
  };
}
