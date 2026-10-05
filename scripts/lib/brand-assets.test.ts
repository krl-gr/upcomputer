import { describe, expect, it } from "vite-plus/test";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  resolveWebAssetBrandForChannel,
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

describe("brand-assets", () => {
  it("maps production web assets into the server package", () => {
    expect(resolveWebIconOverrides("production", "dist/client")).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
    ]);
  });

  it("maps server build web assets to development icons", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
      targetRelativePath: "dist/client/favicon.ico",
    });
  });

  it("maps development web assets to the public splash and favicon files", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
        targetRelativePath: "apps/web/public/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
        targetRelativePath: "apps/web/public/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
        targetRelativePath: "apps/web/public/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
        targetRelativePath: "apps/web/public/apple-touch-icon.png",
      },
    ]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it("maps hosted nightly web assets to nightly icons", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      targetRelativePath: "apps/web/dist/favicon.ico",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("maps package versions to web asset brands", () => {
    expect(resolveWebAssetBrandForPackageVersion("0.0.29")).toBe("production");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-nightly.20260723.882")).toBe("nightly");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-preview.20260723.882")).toBe("nightly");
  });

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
