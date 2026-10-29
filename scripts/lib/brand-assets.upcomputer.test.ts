import { describe, expect, it } from "vite-plus/test";

import { BRAND_ASSET_PATHS } from "./brand-assets.ts";

describe("brand-assets", () => {
  it("points every channel at the Up.computer icon families", () => {
    expect([
      BRAND_ASSET_PATHS.developmentIconComposerProject,
      BRAND_ASSET_PATHS.nightlyIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    ]).toEqual([
      "assets/dev/app-icon.icon",
      "assets/nightly/app-icon.icon",
      "assets/prod/app-icon.icon",
    ]);
    expect(BRAND_ASSET_PATHS.developmentDesktopIconPng).toMatch(
      /^assets\/dev\/upcomputer-blueprint-/,
    );
    // Like V1, nightly builds use the blueprint artwork.
    expect(BRAND_ASSET_PATHS.nightlyMacIconPng).toMatch(/^assets\/dev\/upcomputer-blueprint-/);
    expect(BRAND_ASSET_PATHS.productionMacIconPng).toMatch(/^assets\/prod\/upcomputer-/);
  });
});
