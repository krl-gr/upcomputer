import { describe, expect, it } from "vite-plus/test";

import { freshSignIn, observedClerkAccount, signInPublishStep } from "./connectSignIn.logic";

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

describe("signInPublishStep", () => {
  const ready = { scopesKnown: true, canManageRelay: true, hasTarget: true, linkStateKnown: true };

  it("publishes only with relay management, once scopes and link state are known", () => {
    expect(signInPublishStep(ready)).toBe("publish");
    expect(signInPublishStep({ ...ready, scopesKnown: false, canManageRelay: false })).toBe("wait");
    // No relay scopes, or a managed policy that turns Connect off.
    expect(signInPublishStep({ ...ready, canManageRelay: false })).toBe("skip");
    expect(signInPublishStep({ ...ready, hasTarget: false })).toBe("wait");
    expect(signInPublishStep({ ...ready, linkStateKnown: false })).toBe("wait");
  });
});
