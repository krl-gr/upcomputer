import { describe, expect, it } from "vite-plus/test";

import { resolveAvailableSidebarViewMode, UNIFIED_SIDEBAR_VIEW_MODE } from "./sidebarViewMode";

describe("resolveAvailableSidebarViewMode", () => {
  it("resolves every stored mode to the unified view", () => {
    expect(resolveAvailableSidebarViewMode("nested")).toBe(UNIFIED_SIDEBAR_VIEW_MODE);
    expect(resolveAvailableSidebarViewMode("focused")).toBe(UNIFIED_SIDEBAR_VIEW_MODE);
    expect(resolveAvailableSidebarViewMode("v2")).toBe(UNIFIED_SIDEBAR_VIEW_MODE);
  });
});
