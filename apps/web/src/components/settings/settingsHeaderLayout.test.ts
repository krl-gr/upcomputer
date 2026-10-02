import { describe, expect, it } from "vite-plus/test";

import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { resolveSettingsHeaderClassName } from "./settingsHeaderLayout";

describe("resolveSettingsHeaderClassName", () => {
  it("keeps the narrow desktop header clear of the traffic lights on the list and on sections", () => {
    const className = resolveSettingsHeaderClassName({ isElectron: true, isMobile: true });

    expect(className).toContain("drag-region");
    expect(className).toContain(COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS);
  });

  it("keeps the wide desktop header's collapsed-sidebar inset", () => {
    const className = resolveSettingsHeaderClassName({ isElectron: true, isMobile: false });

    expect(className).toContain(COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS);
  });

  it("keeps the window-controls overlay right padding at every width", () => {
    for (const isMobile of [true, false]) {
      expect(resolveSettingsHeaderClassName({ isElectron: true, isMobile })).toContain(
        "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
      );
    }
  });

  it("starts the phone browser header at the edge", () => {
    const className = resolveSettingsHeaderClassName({ isElectron: false, isMobile: true });

    expect(className).not.toContain(COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS);
    expect(className).not.toContain("drag-region");
  });

  it("keeps the wide browser header's collapsed-sidebar inset", () => {
    const className = resolveSettingsHeaderClassName({ isElectron: false, isMobile: false });

    expect(className).toContain(COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS);
  });
});
