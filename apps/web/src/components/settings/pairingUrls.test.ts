import type { AdvertisedEndpoint } from "@upcomputer/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  endpointShareHint,
  isHostedAppPairingUrl,
  resolveDesktopPairingUrl,
  resolveHostedPairingUrl,
} from "./pairingUrls";

function makeEndpoint(overrides: Partial<AdvertisedEndpoint>): AdvertisedEndpoint {
  return {
    id: "tailscale-magicdns:https://desktop.tail.ts.net/",
    label: "Tailscale HTTPS",
    provider: { id: "tailscale", label: "Tailscale", kind: "private-network", isAddon: true },
    httpBaseUrl: "https://desktop.tail.ts.net/",
    wsBaseUrl: "wss://desktop.tail.ts.net/",
    reachability: "private-network",
    compatibility: { hostedHttpsApp: "compatible", desktopApp: "compatible" },
    source: "desktop-addon",
    status: "available",
    ...overrides,
  };
}

describe("settings pairing URL helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses direct backend pairing URLs for HTTP endpoints", () => {
    expect(resolveHostedPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBeNull();
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
  });

  it("uses direct pairing URLs for HTTPS endpoints when no hosted app is configured", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "");

    expect(resolveHostedPairingUrl("https://desktop.tail.ts.net/", "PAIRCODE")).toBeNull();
    expect(resolveDesktopPairingUrl("https://desktop.tail.ts.net/", "PAIRCODE")).toBe(
      "https://desktop.tail.ts.net/pair#token=PAIRCODE",
    );
  });

  it("uses hosted pairing URLs for HTTPS endpoints only with a configured hosted app", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.t3.codes");

    expect(resolveHostedPairingUrl("https://host.tailnet.example.ts.net:3773", "PAIRCODE")).toBe(
      "https://preview.t3.codes/pair?host=https%3A%2F%2Fhost.tailnet.example.ts.net%3A3773#token=PAIRCODE",
    );
  });

  it("recognizes hosted app links by their host parameter", () => {
    expect(isHostedAppPairingUrl("https://desktop.tail.ts.net/pair#token=PAIRCODE")).toBe(false);
    expect(
      isHostedAppPairingUrl(
        "https://preview.t3.codes/pair?host=https%3A%2F%2Fdesktop.tail.ts.net#token=PAIRCODE",
      ),
    ).toBe(true);
    expect(isHostedAppPairingUrl("not a url")).toBe(false);
  });

  it("describes HTTPS endpoints as installable and keeps reachability hints otherwise", () => {
    const tailscaleHttps = makeEndpoint({});
    expect(
      endpointShareHint(
        tailscaleHttps,
        resolveDesktopPairingUrl(tailscaleHttps.httpBaseUrl, "PAIRCODE"),
      ),
    ).toBe("Installable app over HTTPS");
    expect(
      endpointShareHint(
        tailscaleHttps,
        "https://preview.t3.codes/pair?host=https%3A%2F%2Fdesktop.tail.ts.net#token=PAIRCODE",
      ),
    ).toBe("Opens the hosted app, no install needed");

    const lan = makeEndpoint({
      id: "desktop-lan:http://192.168.1.42:4780",
      httpBaseUrl: "http://192.168.1.42:4780",
      reachability: "lan",
    });
    expect(endpointShareHint(lan, "http://192.168.1.42:4780/pair#token=PAIRCODE")).toBe(
      "Devices on the same network",
    );
  });
});
