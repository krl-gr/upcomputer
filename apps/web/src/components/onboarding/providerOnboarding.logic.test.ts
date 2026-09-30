import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  areInitialProviderProbesSettled,
  countUsableProviders,
  getProviderOnboardingRowState,
  hasUsableProvider,
  isProviderUsable,
  shouldShowInitialProviderOnboarding,
  shouldOfferInitialProjectImport,
} from "./providerOnboarding.logic";

function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("test"),
    driver: ProviderDriverKind.make("test"),
    enabled: true,
    installed: true,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    checkedAt: "2026-08-04T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("provider onboarding gate", () => {
  it("waits for initial provider probes instead of latching pending state", () => {
    const pending = provider({ probeStatus: "checking" });
    expect(areInitialProviderProbesSettled([pending])).toBe(false);
    expect(shouldShowInitialProviderOnboarding({ providers: [pending], dismissed: false })).toBe(
      null,
    );
  });

  it("accepts a ready provider whose authentication cannot be independently verified", () => {
    const ready = provider({
      probeStatus: "settled",
      status: "ready",
      models: [{ slug: "model", name: "Model", isCustom: false, capabilities: null }],
    });
    expect(hasUsableProvider([ready])).toBe(true);
    expect(shouldShowInitialProviderOnboarding({ providers: [ready], dismissed: false })).toBe(
      false,
    );
  });

  it("accepts an authenticated warning provider with available models", () => {
    const authenticated = provider({
      probeStatus: "settled",
      auth: { status: "authenticated" },
      models: [{ slug: "model", name: "Model", isCustom: false, capabilities: null }],
    });
    expect(hasUsableProvider([authenticated])).toBe(true);
  });

  it("shows onboarding only after settling with no usable provider", () => {
    expect(
      shouldShowInitialProviderOnboarding({
        providers: [provider({ probeStatus: "settled", installed: false })],
        dismissed: false,
      }),
    ).toBe(true);
  });

  it("does not treat an empty provider registry as settled", () => {
    expect(areInitialProviderProbesSettled([])).toBe(false);
    expect(shouldShowInitialProviderOnboarding({ providers: [], dismissed: false })).toBe(null);
  });

  it("falls back to onboarding after the bounded probe wait expires", () => {
    expect(
      shouldShowInitialProviderOnboarding({
        providers: [provider({ probeStatus: "checking" })],
        dismissed: false,
        probeWaitExpired: true,
      }),
    ).toBe(true);
  });

  it("honors a persisted dismissal", () => {
    expect(
      shouldShowInitialProviderOnboarding({
        providers: [provider({ probeStatus: "settled", installed: false })],
        dismissed: true,
      }),
    ).toBe(false);
  });
});

const usable = provider({
  probeStatus: "settled",
  status: "ready",
  models: [{ slug: "model", name: "Model", isCustom: false, capabilities: null }],
});

describe("provider onboarding readiness", () => {
  it("counts every usable instance so the header can state the exit condition", () => {
    expect(countUsableProviders([usable, provider({ installed: false })])).toBe(1);
    expect(countUsableProviders([])).toBe(0);
  });

  it("refuses readiness for an instance the runtime would skip for new sessions", () => {
    expect(isProviderUsable({ ...usable, enabled: false })).toBe(false);
    expect(isProviderUsable({ ...usable, availability: "unavailable" })).toBe(false);
    expect(isProviderUsable({ ...usable, models: [] })).toBe(false);
  });

  it("derives each row's state from the same predicate as the gate", () => {
    expect(getProviderOnboardingRowState(usable)).toBe("ready");
    expect(hasUsableProvider([usable])).toBe(true);
  });

  it("keeps an unsettled probe distinct from a negative answer", () => {
    expect(getProviderOnboardingRowState(provider({ probeStatus: "checking" }))).toBe("checking");
    expect(
      getProviderOnboardingRowState(provider({ probeStatus: "settled", installed: false })),
    ).toBe("not-installed");
  });

  it("surfaces a disabled-but-installed agent as its own state, not as not-installed", () => {
    expect(
      getProviderOnboardingRowState({ ...usable, enabled: false, probeStatus: "settled" }),
    ).toBe("disabled");
  });

  it("names the unmet condition instead of collapsing it into 'not connected'", () => {
    expect(
      getProviderOnboardingRowState(
        provider({ probeStatus: "settled", auth: { status: "unauthenticated" } }),
      ),
    ).toBe("needs-auth");
    // Signed in, but the driver exposes nothing to run: calling this a missing
    // connection would contradict the server's own "Authenticated" status.
    expect(getProviderOnboardingRowState({ ...usable, models: [] })).toBe("needs-models");
    expect(
      getProviderOnboardingRowState(
        provider({ probeStatus: "settled", status: "ready", models: [] }),
      ),
    ).toBe("needs-models");
  });

  it("reports a missing or unavailable instance as unavailable", () => {
    expect(getProviderOnboardingRowState(undefined)).toBe("unavailable");
    expect(
      getProviderOnboardingRowState(
        provider({ probeStatus: "settled", availability: "unavailable" }),
      ),
    ).toBe("unavailable");
  });
});

describe("initial project import offer", () => {
  it("offers import on a fresh workspace with projects left to import", () => {
    expect(
      shouldOfferInitialProjectImport({
        dismissed: false,
        projectCount: 0,
        candidates: [{ alreadyImported: true }, { alreadyImported: false }],
      }),
    ).toBe(true);
  });

  it("waits for the scan before deciding", () => {
    expect(
      shouldOfferInitialProjectImport({ dismissed: false, projectCount: 0, candidates: null }),
    ).toBeNull();
  });

  it("stays closed after dismissal, once projects exist, or with nothing new to import", () => {
    const candidates = [{ alreadyImported: false }];
    expect(shouldOfferInitialProjectImport({ dismissed: true, projectCount: 0, candidates })).toBe(
      false,
    );
    expect(shouldOfferInitialProjectImport({ dismissed: false, projectCount: 1, candidates })).toBe(
      false,
    );
    expect(
      shouldOfferInitialProjectImport({
        dismissed: false,
        projectCount: 0,
        candidates: [{ alreadyImported: true }],
      }),
    ).toBe(false);
    expect(
      shouldOfferInitialProjectImport({ dismissed: false, projectCount: 0, candidates: [] }),
    ).toBe(false);
  });
});
