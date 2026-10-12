import { describe, expect, it } from "vite-plus/test";
import * as OpenApi from "effect/http-api/OpenApi";
import * as Schema from "effect/Schema";

import { RelayApi, RelayDeviceRegistrationRequest } from "./relay.ts";

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
  it.each([
    [23, "Failure"],
    [24, "Success"],
    [37, "Success"],
  ])("enforces the Android minimum without an upper bound (API %i)", (androidApiLevel, result) => {
    expect(decodeDevice({ ...device, platform: "android", androidApiLevel })._tag).toBe(result);
  });

  it("accepts Android tokens without Apple routing and preserves older iOS registrations", () => {
    expect(decodeDevice({ ...device, platform: "android", androidApiLevel: 36 })._tag).toBe(
      "Success",
    );
    expect(decodeDevice({ ...device, platform: "ios", iosMajorVersion: 18 })._tag).toBe("Success");
  });
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
      p256dh: "public-key",
      auth: "secret",
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
});

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});
