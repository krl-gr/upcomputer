import { describe, expect, it } from "vite-plus/test";

import type { ServerProvider } from "@t3tools/contracts";

import { providerCompatibilityRowHint, providerRowCanUpdateAll } from "./providerStatus";

describe("an old provider version's row", () => {
  // QA .771 saw a 4-month-old Codex 0.145.0 as "Incompatible", with no way forward named.
  const codex0145 = {
    status: "broken" as const,
    latestVersionStatus: "supported" as const,
    message: null,
    recommendedVersion: null,
    recommendedRange: ">=0.159.0",
  };

  it("names the version to reach and how", () => {
    expect(providerCompatibilityRowHint(codex0145, true)).toBe(
      "Update to v0.159.0 or newer with Update all",
    );
    expect(providerCompatibilityRowHint({ ...codex0145, status: "graceful" }, false)).toBe(
      "Limited support. Update to v0.159.0 or newer",
    );
  });

  it("keeps the plain status when updating cannot help", () => {
    expect(
      providerCompatibilityRowHint({ ...codex0145, latestVersionStatus: "broken" }, true),
    ).toBe("Incompatible");
    expect(providerCompatibilityRowHint({ ...codex0145, recommendedRange: "^0.159.0" }, true)).toBe(
      "Incompatible",
    );
  });
});

describe("whether an old provider's row may point at Update all", () => {
  const codex = (canUpdate: boolean) =>
    ({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      compatibilityAdvisory: { latestVersionStatus: "supported" },
      versionAdvisory: {
        status: "behind_latest",
        latestVersion: "0.159.0",
        canUpdate,
        updateCommand: canUpdate ? "npm i -g @openai/codex@latest" : null,
      },
    }) as unknown as ServerProvider;

  it("only when Update all can update this install", () => {
    expect(providerRowCanUpdateAll(codex(true), [codex(true)])).toBe(true);
    expect(providerRowCanUpdateAll(codex(false), [codex(false)])).toBe(false);
    expect(providerRowCanUpdateAll(undefined, [])).toBe(false);
  });
});
