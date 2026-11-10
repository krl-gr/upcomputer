import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  computersToAdd,
  connectIsOnFor,
  type DiscoveredComputer,
  freshSignIn,
  NO_SIGN_IN_REQUESTS,
  nextSignInRequests,
  observedClerkAccount,
  shouldRelinkStaleKey,
  signInPublishStep,
} from "./connectSignIn.logic";

describe("freshSignIn", () => {
  it("starts only when an account appears after the app saw another state", () => {
    const signedOut = observedClerkAccount({ isLoaded: true, isSignedIn: false, userId: null });
    const signedIn = observedClerkAccount({ isLoaded: true, isSignedIn: true, userId: "user_a" });
    const loading = observedClerkAccount({ isLoaded: false, isSignedIn: undefined, userId: null });
    const incomplete = observedClerkAccount({ isLoaded: true, isSignedIn: true, userId: null });

    // Launching signed in is no sign-in, so a user who turned publishing off stays off.
    expect(freshSignIn(undefined, signedIn)).toBeNull();
    expect(freshSignIn(loading, signedIn)).toBeNull();
    expect(incomplete).toBeUndefined();
    expect(freshSignIn(signedOut, signedIn)).toBe("user_a");
    expect(freshSignIn("user_b", signedIn)).toBe("user_a");
    expect(freshSignIn(signedIn, signedIn)).toBeNull();
    expect(freshSignIn(signedIn, signedOut)).toBeNull();
  });
});

describe("nextSignInRequests", () => {
  it("keeps a fresh sign-in's requests through an incomplete snapshot, and ends them on sign-out", () => {
    const launched = nextSignInRequests(NO_SIGN_IN_REQUESTS, null);
    const signedIn = nextSignInRequests(launched, "user_a");
    expect(signedIn).toEqual({ observed: "user_a", publishFor: "user_a", addingFor: "user_a" });
    // A brief signed-in snapshot without a user id says nothing about the account.
    expect(nextSignInRequests(signedIn, undefined)).toBe(signedIn);
    expect(nextSignInRequests(signedIn, "user_a")).toBe(signedIn);
    expect(nextSignInRequests(signedIn, null)).toEqual({
      observed: null,
      publishFor: null,
      addingFor: null,
    });
    // Launching signed in starts nothing.
    expect(nextSignInRequests(NO_SIGN_IN_REQUESTS, "user_a")).toEqual({
      observed: "user_a",
      publishFor: null,
      addingFor: null,
    });
  });
});

describe("signInPublishStep", () => {
  const linked = (cloudUserId: string | null, linkRevoked = false) => ({
    data: { linked: cloudUserId !== null, linkRevoked, cloudUserId },
    error: null,
  });
  const ready = {
    account: "user_a",
    scopesKnown: true,
    canManageRelay: true,
    hasTarget: true,
    linkState: linked(null),
  };

  it("publishes only with relay management, once scopes and a readable link state are known", () => {
    expect(signInPublishStep(ready)).toBe("publish");
    expect(signInPublishStep({ ...ready, scopesKnown: false, canManageRelay: false })).toBe("wait");
    // No relay scopes, or a managed policy that turns Connect off.
    expect(signInPublishStep({ ...ready, canManageRelay: false })).toBe("skip");
    expect(signInPublishStep({ ...ready, hasTarget: false })).toBe("wait");
    expect(signInPublishStep({ ...ready, linkState: { data: null, error: null } })).toBe("wait");
    // An unreadable link state waits rather than failing the publish for good.
    expect(signInPublishStep({ ...ready, linkState: { data: null, error: "offline" } })).toBe(
      "wait",
    );
  });

  it("leaves a link that belongs to another account to the user", () => {
    expect(signInPublishStep({ ...ready, linkState: linked("user_a") })).toBe("publish");
    expect(signInPublishStep({ ...ready, linkState: linked("user_b") })).toBe("other-account");
    expect(signInPublishStep({ ...ready, linkState: linked("user_b", true) })).toBe("publish");
  });
});

describe("computersToAdd", () => {
  const mac = EnvironmentId.make("env-mac");
  const windows = EnvironmentId.make("env-windows");
  const linux = EnvironmentId.make("env-linux");
  const computer = (
    environmentId: EnvironmentId,
    overrides: Partial<DiscoveredComputer> = {},
  ): DiscoveredComputer => ({
    environmentId,
    availability: "online",
    compatible: true,
    ...overrides,
  });
  const none = new Set<EnvironmentId>();
  const onMac = {
    discovered: [computer(mac), computer(windows)],
    primaryEnvironmentId: mac,
    saved: new Set([mac]),
    known: new Set([mac]),
    attempted: none,
  };

  it("adds a computer that joined the account later, once its relay status is in", () => {
    expect(computersToAdd(onMac)).toEqual([windows]);
    expect(
      computersToAdd({ ...onMac, discovered: [computer(windows, { availability: "offline" })] }),
    ).toEqual([windows]);
    expect(
      computersToAdd({ ...onMac, discovered: [computer(windows, { availability: "checking" })] }),
    ).toEqual([]);
    expect(
      computersToAdd({ ...onMac, discovered: [computer(windows, { availability: "error" })] }),
    ).toEqual([]);
    // Already saved, or already being added in this session.
    expect(computersToAdd({ ...onMac, saved: new Set([mac, windows]) })).toEqual([]);
    expect(computersToAdd({ ...onMac, attempted: new Set([windows]) })).toEqual([]);
  });

  it("keeps a computer the user removed on this device removed", () => {
    expect(computersToAdd({ ...onMac, known: new Set([mac, windows]) })).toEqual([]);
    expect(
      computersToAdd({
        ...onMac,
        discovered: [computer(windows), computer(linux)],
        known: new Set([mac, windows]),
      }),
    ).toEqual([linux]);
  });

  it("waits for a computer whose version cannot serve this client", () => {
    expect(
      computersToAdd({ ...onMac, discovered: [computer(windows, { compatible: false })] }),
    ).toEqual([]);
  });
});

describe("connectIsOnFor", () => {
  it("is on only while this computer is linked to the signed-in account", () => {
    const link = { linked: true, linkRevoked: false, cloudUserId: "user_a" };
    expect(connectIsOnFor("user_a", link)).toBe(true);
    // Connect turned off on this computer, a revoked link, or another account's link.
    expect(connectIsOnFor("user_a", { linked: false, cloudUserId: null })).toBe(false);
    expect(connectIsOnFor("user_a", { ...link, linkRevoked: true })).toBe(false);
    expect(connectIsOnFor("user_a", { ...link, cloudUserId: "user_b" })).toBe(false);
    expect(connectIsOnFor("user_a", null)).toBe(false);
  });
});

describe("shouldRelinkStaleKey", () => {
  const stale = {
    linked: true,
    linkRevoked: false,
    linkKeyStale: true,
    cloudUserId: "user_a",
  };

  it("relinks only the signed-in owner's link whose key the relay no longer accepts", () => {
    expect(
      shouldRelinkStaleKey({ account: "user_a", canManageRelay: true, linkState: stale }),
    ).toBe(true);
    // Another account's link, a revoked link, or no relay management stay the user's call.
    expect(
      shouldRelinkStaleKey({ account: "user_b", canManageRelay: true, linkState: stale }),
    ).toBe(false);
    expect(
      shouldRelinkStaleKey({
        account: "user_a",
        canManageRelay: true,
        linkState: { ...stale, linkRevoked: true },
      }),
    ).toBe(false);
    expect(
      shouldRelinkStaleKey({ account: "user_a", canManageRelay: false, linkState: stale }),
    ).toBe(false);
    expect(shouldRelinkStaleKey({ account: null, canManageRelay: true, linkState: stale })).toBe(
      false,
    );
    expect(
      shouldRelinkStaleKey({
        account: "user_a",
        canManageRelay: true,
        linkState: { ...stale, linkKeyStale: false },
      }),
    ).toBe(false);
  });
});
