import { describe, expect, it } from "vite-plus/test";

import {
  freshSignIn,
  NO_SIGN_IN_REQUESTS,
  nextSignInRequests,
  observedClerkAccount,
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
