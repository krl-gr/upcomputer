import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { RelayDeviceRegistrationRequest } from "./relay.ts";

const decodeDevice = Schema.decodeUnknownExit(RelayDeviceRegistrationRequest);
const device = {
  deviceId: "device",
  label: "Phone",
  pushToken: "token",
  preferences: {
    notificationsEnabled: true,
    liveActivitiesEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};

describe("mobile device platforms", () => {
  it("rejects missing platform versions and Apple activity tokens on Android", () => {
    expect(decodeDevice({ ...device, platform: "ios" })._tag).toBe("Failure");
    expect(decodeDevice({ ...device, platform: "android" })._tag).toBe("Failure");
    expect(
      decodeDevice({
        ...device,
        platform: "android",
        androidApiLevel: 36,
        pushToStartToken: "apple-token",
      })._tag,
    ).toBe("Failure");
  });
});

describe("web push devices", () => {
  const web = {
    deviceId: "browser",
    label: "Safari on iPhone",
    platform: "web",
    webPush: {
      endpoint: "https://web.push.apple.com/abc",
      p256dh: Base64Url.encode(new Uint8Array(65).fill(4)),
      auth: Base64Url.encode(new Uint8Array(16).fill(7)),
    },
    preferences: device.preferences,
  };

  it("accepts a web device with its push subscription", () => {
    expect(decodeDevice(web)._tag).toBe("Success");
  });

  it("rejects web devices without a subscription or with mobile fields, and subscriptions on mobile", () => {
    expect(decodeDevice({ ...web, webPush: undefined })._tag).toBe("Failure");
    expect(decodeDevice({ ...web, pushToken: "token" })._tag).toBe("Failure");
    expect(decodeDevice({ ...web, iosMajorVersion: 18 })._tag).toBe("Failure");
    expect(
      decodeDevice({ ...web, webPush: { ...web.webPush, endpoint: "http://push.test/abc" } })._tag,
    ).toBe("Failure");
    expect(
      decodeDevice({ ...device, platform: "android", androidApiLevel: 36, webPush: web.webPush })
        ._tag,
    ).toBe("Failure");
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/dXk3UmFfR0w:APA91bH6b1Kx-9Yp_2rT",
    "https://web.push.apple.com/QGuQyavXutnMHqjVhN7m5r3X7DHpQ6BtRXFYMeVA",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk2fL7xQ",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD3%2bxM",
    "https://fcm.googleapis.com:443/fcm/send/abc",
  ])("accepts the endpoint format of a real push service: %s", (endpoint) => {
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(true);
    expect(decodeDevice({ ...web, webPush: { ...web.webPush, endpoint } })._tag).toBe("Success");
  });

  it.each([
    "https://127.0.0.1/admin",
    "https://[::1]/admin",
    "https://2130706433/admin",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    "https://attacker.example/fcm/send/abc",
    "https://fcm.googleapis.com.attacker.example/abc",
    "https://attacker-push.apple.com/abc",
    "https://push.apple.com/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://%",
    `https://fcm.googleapis.com/fcm/send/${"a".repeat(MAX_WEB_PUSH_ENDPOINT_LENGTH)}`,
  ])("rejects an endpoint the relay must not send to: %s", (endpoint) => {
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(false);
    expect(decodeDevice({ ...web, webPush: { ...web.webPush, endpoint } })._tag).toBe("Failure");
  });

  it.each([
    ["p256dh", "public-key"],
    ["p256dh", Base64Url.encode(new Uint8Array(64).fill(4))],
    ["p256dh", Base64Url.encode(new Uint8Array(66).fill(4))],
    ["auth", "secret"],
    ["auth", Base64Url.encode(new Uint8Array(15).fill(7))],
    ["auth", Base64Url.encode(new Uint8Array(17).fill(7))],
    ["auth", "%%%%%%%%%%%%%%%%%%%%%%"],
  ])("rejects a malformed %s key", (field, value) => {
    expect(decodeDevice({ ...web, webPush: { ...web.webPush, [field]: value } })._tag).toBe(
      "Failure",
    );
  });
});
