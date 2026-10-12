import { describe, expect, it } from "vite-plus/test";

import {
  webPushDeviceLabel,
  type WebPushEnvironment,
  webPushRegistrationRequest,
  webPushSupport,
} from "./webPush";

const iPhoneSafari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const iPadSafari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const androidChrome =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const windowsEdge =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

const browser: WebPushEnvironment = {
  isElectron: false,
  isSecureContext: true,
  userAgent: androidChrome,
  maxTouchPoints: 5,
  standalone: false,
  hasPushApi: true,
};

describe("webPushSupport", () => {
  it("leaves the desktop app to its own notifications", () => {
    expect(webPushSupport({ ...browser, isElectron: true })).toBe("desktop-app");
  });

  it("asks iPhone and iPad users to open the Home Screen app first", () => {
    for (const userAgent of [iPhoneSafari, iPadSafari]) {
      expect(webPushSupport({ ...browser, userAgent, hasPushApi: false })).toBe(
        "needs-home-screen",
      );
      expect(webPushSupport({ ...browser, userAgent, standalone: true })).toBe("supported");
    }
  });

  it("treats a Mac without touch as a regular browser", () => {
    expect(webPushSupport({ ...browser, userAgent: iPadSafari, maxTouchPoints: 0 })).toBe(
      "supported",
    );
  });

  it("needs the Push API and a secure context", () => {
    expect(webPushSupport(browser)).toBe("supported");
    expect(webPushSupport({ ...browser, hasPushApi: false })).toBe("unsupported");
    expect(webPushSupport({ ...browser, isSecureContext: false })).toBe("unsupported");
  });
});

describe("webPushDeviceLabel", () => {
  it.each([
    [iPhoneSafari, 5, "Safari on iPhone"],
    [iPadSafari, 5, "Safari on iPad"],
    [iPadSafari, 0, "Safari on Mac"],
    [androidChrome, 5, "Chrome on Android"],
    [windowsEdge, 0, "Edge on Windows"],
    ["Unknown", 0, "Browser"],
  ])("labels %s with %i touch points as %s", (userAgent, maxTouchPoints, label) => {
    expect(webPushDeviceLabel({ userAgent, maxTouchPoints })).toBe(label);
  });
});

describe("webPushRegistrationRequest", () => {
  it("registers the subscription as a web device that only alerts", () => {
    expect(
      webPushRegistrationRequest({
        deviceId: "device",
        label: "Safari on iPhone",
        subscription: {
          endpoint: "https://web.push.apple.com/abc",
          keys: { p256dh: "public", auth: "secret" },
        },
      }),
    ).toMatchObject({
      deviceId: "device",
      platform: "web",
      webPush: { endpoint: "https://web.push.apple.com/abc", p256dh: "public", auth: "secret" },
      preferences: { notificationsEnabled: true, liveActivitiesEnabled: false },
    });
  });

  it("rejects an incomplete subscription", () => {
    expect(
      webPushRegistrationRequest({
        deviceId: "device",
        label: "Browser",
        subscription: { endpoint: "https://push.test/abc", keys: { p256dh: "public" } },
      }),
    ).toBeNull();
  });
});
