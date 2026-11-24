import { describe, expect, it } from "vite-plus/test";

import { providerCompatibilityRowHint } from "./providerStatus";

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
