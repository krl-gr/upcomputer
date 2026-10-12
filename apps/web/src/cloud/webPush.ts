import {
  ManagedRelay,
  type ManagedRelaySession,
  ManagedRelaySessionError,
} from "@t3tools/client-runtime/relay";
import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";

import { APP_VERSION } from "../branding";
import { runtime } from "../lib/runtime";
import { randomUUID } from "../lib/utils";
import { trimNonEmpty } from "./publicConfig";

// Agent alerts from the relay while Up.computer is closed. The browser keeps a
// push subscription for the service worker in public/push-sw.js; the relay
// stores it as a `web` device of the signed-in Connect account.

const SERVICE_WORKER_URL = "/push-sw.js";
const SERVICE_WORKER_SCOPE = "/";
const STORAGE_KEY = "upcomputer:web-push-device";

export function resolveWebPushVapidPublicKey(): string | null {
  return trimNonEmpty(import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY as string | undefined);
}

export type WebPushSupport = "desktop-app" | "needs-home-screen" | "unsupported" | "supported";

export interface WebPushEnvironment {
  readonly isElectron: boolean;
  readonly isSecureContext: boolean;
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** Opened from the Home Screen (or installed), not in a browser tab. */
  readonly standalone: boolean;
  readonly hasPushApi: boolean;
}

function isAppleMobile(environment: Pick<WebPushEnvironment, "userAgent" | "maxTouchPoints">) {
  // iPadOS reports a Mac user agent; touch points tell them apart.
  return (
    /iPhone|iPad|iPod/.test(environment.userAgent) ||
    (/Macintosh/.test(environment.userAgent) && environment.maxTouchPoints > 1)
  );
}

export function webPushSupport(environment: WebPushEnvironment): WebPushSupport {
  // The desktop app shows its own notifications.
  if (environment.isElectron) return "desktop-app";
  // iOS and iPadOS offer web push only to web apps opened from the Home Screen.
  if (isAppleMobile(environment) && !environment.standalone) return "needs-home-screen";
  return environment.isSecureContext && environment.hasPushApi ? "supported" : "unsupported";
}

export function readWebPushEnvironment(isElectron: boolean): WebPushEnvironment {
  return {
    isElectron,
    isSecureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { readonly standalone?: boolean }).standalone === true,
    hasPushApi: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
  };
}

/** A name the user recognizes in the relay's device records, such as "Safari on iPhone". */
export function webPushDeviceLabel(
  environment: Pick<WebPushEnvironment, "userAgent" | "maxTouchPoints">,
) {
  const { userAgent } = environment;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\/|FxiOS\//.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent) || isAppleMobile(environment)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return device ? `${browser} on ${device}` : browser;
}

export function webPushRegistrationRequest(input: {
  readonly deviceId: string;
  readonly label: string;
  readonly subscription: PushSubscriptionJSON;
}): RelayDeviceRegistrationRequest | null {
  const { endpoint, keys } = input.subscription;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return {
    deviceId: input.deviceId,
    label: input.label,
    platform: "web",
    appVersion: APP_VERSION,
    webPush: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
    preferences: {
      notificationsEnabled: true,
      liveActivitiesEnabled: false,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
  };
}

interface StoredWebPushDevice {
  readonly deviceId: string;
  readonly accountId: string;
  readonly endpoint: string;
}

function readStoredDevice(): StoredWebPushDevice | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "deviceId" in value &&
      typeof value.deviceId === "string" &&
      "accountId" in value &&
      typeof value.accountId === "string" &&
      "endpoint" in value &&
      typeof value.endpoint === "string"
    ) {
      return { deviceId: value.deviceId, accountId: value.accountId, endpoint: value.endpoint };
    }
  } catch {
    // Unreadable storage counts as not enabled.
  }
  return null;
}

function writeStoredDevice(device: StoredWebPushDevice | null) {
  try {
    if (device) localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the device simply shows as off next time.
  }
}

async function readSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function sameKey(key: ArrayBuffer | null, expected: Uint8Array) {
  if (!key || key.byteLength !== expected.length) return false;
  const actual = new Uint8Array(key);
  return expected.every((byte, index) => actual[index] === byte);
}

const requireClerkToken = (session: ManagedRelaySession) =>
  session
    .readClerkToken()
    .pipe(
      Effect.flatMap((token) =>
        token
          ? Effect.succeed(token)
          : Effect.fail(
              new ManagedRelaySessionError({ message: "Sign in to Up.computer Connect first." }),
            ),
      ),
    );

/** On for this device: subscribed, permitted, and registered for this account. */
export async function readWebPushEnabled(accountId: string): Promise<boolean> {
  const stored = readStoredDevice();
  if (stored?.accountId !== accountId || Notification.permission !== "granted") return false;
  const subscription = await readSubscription();
  return subscription?.endpoint === stored.endpoint;
}

export type EnableWebPushResult = "enabled" | "denied";

/** Asks for permission, subscribes this browser and registers it with the relay. */
export async function enableWebPush(input: {
  readonly session: ManagedRelaySession;
  readonly vapidPublicKey: string;
  readonly label: string;
}): Promise<EnableWebPushResult> {
  // First, while the click still counts as a user gesture: Safari requires it.
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const applicationServerKey = Base64Url.decode(input.vapidPublicKey);
  if (Result.isFailure(applicationServerKey)) {
    throw new Error("This build has an invalid web push key.");
  }
  const key = new Uint8Array(applicationServerKey.success);
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: SERVICE_WORKER_SCOPE,
  });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A rotated VAPID key invalidates the old subscription.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });

  const stored = readStoredDevice();
  const deviceId = stored?.deviceId ?? randomUUID();
  const payload = webPushRegistrationRequest({
    deviceId,
    label: input.label,
    subscription: subscription.toJSON(),
  });
  if (!payload) throw new Error("The browser returned an incomplete push subscription.");
  await runtime.runPromise(
    Effect.gen(function* () {
      const clerkToken = yield* requireClerkToken(input.session);
      const relay = yield* ManagedRelay.ManagedRelayClient;
      yield* relay.registerDevice({ clerkToken, payload });
    }),
  );
  writeStoredDevice({
    deviceId,
    accountId: input.session.accountId,
    endpoint: subscription.endpoint,
  });
  return "enabled";
}

/**
 * Stops pushes to this device. The subscription goes first, so no alert
 * arrives even if the relay cannot be reached; the relay then drops the
 * device when its push service reports the subscription gone.
 */
export async function disableWebPush(session: ManagedRelaySession | null): Promise<void> {
  const stored = readStoredDevice();
  await (await readSubscription())?.unsubscribe();
  writeStoredDevice(null);
  if (!session || !stored || stored.accountId !== session.accountId) return;
  await runtime.runPromise(
    Effect.gen(function* () {
      const clerkToken = yield* requireClerkToken(session);
      const relay = yield* ManagedRelay.ManagedRelayClient;
      yield* relay.unregisterDevice({ clerkToken, deviceId: stored.deviceId });
    }),
  );
}

/** Signing out of Connect stops this device's alerts for that account. */
export async function forgetWebPushDevice(): Promise<void> {
  if (!readStoredDevice() || !("serviceWorker" in navigator)) return;
  await disableWebPush(null);
}

/** Lets a clicked push notification route the already open app to its thread. */
export function listenForWebPushNavigation(
  open: (thread: { readonly environmentId: string; readonly threadId: string }) => void,
): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "upcomputer:open-thread" &&
      "environmentId" in data &&
      typeof data.environmentId === "string" &&
      "threadId" in data &&
      typeof data.threadId === "string"
    ) {
      open({ environmentId: data.environmentId, threadId: data.threadId });
    }
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  navigator.serviceWorker.startMessages();
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
