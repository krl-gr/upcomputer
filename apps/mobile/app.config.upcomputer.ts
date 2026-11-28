import type { ExpoConfig } from "expo/config";
import { UPCOMPUTER_PROTOCOL_SCHEME } from "@t3tools/shared/upcomputerIdentity";

import { rebrandLine } from "../../scripts/lib/branding.ts";

/**
 * Up.computer's identity on top of upstream's finished Expo config, so
 * app.config.ts keeps upstream's text. See docs/branding.md.
 */

type AppVariant = "development" | "preview" | "production";

const UPSTREAM_BUNDLE_IDENTIFIER = "com.t3tools.t3code";
// Proposed, not confirmed: an App Store or TestFlight record fixes it for good.
// Kept apart from the desktop's computer.up.upcomputer so an iPhone app running
// on a Mac never shares the desktop app's bundle id, keychain or URL scheme.
export const UPCOMPUTER_MOBILE_BUNDLE_IDENTIFIER = "computer.up.upcomputer.mobile";

// Cut from the iOS icon (assets/prod/upcomputer-ios-1024.png): its body gradient is the background,
// its disc the foreground. One set for every variant, like iOS. The disc sits a little further in
// than on iOS so round launcher masks keep it whole; the monochrome glyph is centred.
const ANDROID_ASSETS = {
  adaptiveForeground: "./assets/upcomputer/android-icon-foreground.png",
  adaptiveBackground: "./assets/upcomputer/android-icon-background.png",
  adaptiveBackgroundColor: "#322F2F",
  monochrome: "./assets/upcomputer/android-icon-monochrome.png",
  notificationIcon: "./assets/upcomputer/android-notification-icon.png",
  notificationColor: "#322F2F",
  splashIcon: "./assets/upcomputer/android-splash-icon.png",
} as const;

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
// The Android notification, shortcut and splash artwork replaces upstream's.
const PLUGIN_OPTIONS: Record<string, Record<string, unknown>> = {
  "@clerk/expo": { appleSignIn: false },
  "expo-notifications": {
    icon: ANDROID_ASSETS.notificationIcon,
    color: ANDROID_ASSETS.notificationColor,
  },
  "expo-quick-actions": {
    androidIcons: {
      shortcut_icon: {
        foregroundImage: ANDROID_ASSETS.adaptiveForeground,
        backgroundImage: ANDROID_ASSETS.adaptiveBackground,
        backgroundColor: ANDROID_ASSETS.adaptiveBackgroundColor,
      },
    },
  },
  "expo-secure-store": {
    faceIDPermission: "Allow Up.computer to access your Face ID biometric data.",
  },
  // Android 12+ masks the middle two thirds of the 288dp canvas, like a launcher icon.
  "expo-splash-screen": {
    android: {
      image: ANDROID_ASSETS.splashIcon,
      imageWidth: 288,
      dark: { image: ANDROID_ASSETS.splashIcon },
    },
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
  const { owner: _owner, ...upstream } = config;
  const branded = rebrand(upstream) as Omit<ExpoConfig, "owner">;
  // Universal links and passkeys need our domains' association files (later phase).
  // The upstream Icon Composer projects carry the T3 mark; the PNG icon applies.
  const {
    associatedDomains: _associatedDomains,
    appleTeamId: _appleTeamId,
    icon: _icon,
    ...ios
  } = branded.ios ?? {};
  // App links need our domain's assetlinks.json for our package and signing key (later phase),
  // and a Firebase file belongs to the package it was made for.
  const {
    intentFilters: _intentFilters,
    googleServicesFile: _googleServicesFile,
    adaptiveIcon: _adaptiveIcon,
    ...android
  } = branded.android ?? {};
  // The EAS project and its update channel belong to upstream.
  const { projectId: _projectId, ...eas } = (branded.extra?.eas ?? {}) as Record<string, unknown>;
  const appleTeamId = env.T3CODE_IOS_TEAM_ID?.trim();

  return {
    ...branded,
    scheme: SCHEMES[variant],
    updates: { enabled: false },
    ios: { ...ios, ...(appleTeamId ? { appleTeamId } : {}) },
    android: {
      ...android,
      adaptiveIcon: {
        foregroundImage: ANDROID_ASSETS.adaptiveForeground,
        backgroundImage: ANDROID_ASSETS.adaptiveBackground,
        backgroundColor: ANDROID_ASSETS.adaptiveBackgroundColor,
        monochromeImage: ANDROID_ASSETS.monochrome,
      },
    },
    plugins: branded.plugins?.map(withPluginOptions),
    extra: { ...branded.extra, eas, agentAwarenessPushEnabled: false },
  };
}
