// @effect-diagnostics nodeBuiltinImport:off - This regression test inspects the titlebar inset stylesheet.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
  resolveLeftEdgeTitlebarInsetClass,
} from "./workspaceTitlebar";

const indexCss = NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");

describe("resolveLeftEdgeTitlebarInsetClass", () => {
  it("keeps the desktop inset in the narrow layout, where the closed sidebar sheet reads as collapsed", () => {
    expect(resolveLeftEdgeTitlebarInsetClass({ isElectron: true, isMobile: true })).toBe(
      COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
    );
    expect(COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS).toContain("[data-sidebar-state=collapsed]");
  });

  it("keeps the wide-window inset in desktop and browser", () => {
    expect(resolveLeftEdgeTitlebarInsetClass({ isElectron: true, isMobile: false })).toBe(
      COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
    );
    expect(resolveLeftEdgeTitlebarInsetClass({ isElectron: false, isMobile: false })).toBe(
      COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
    );
  });

  it("gives phone browsers no inset", () => {
    expect(resolveLeftEdgeTitlebarInsetClass({ isElectron: false, isMobile: true })).toBeNull();
  });

  it("reserves the macOS traffic lights through the shared inset variable", () => {
    expect(indexCss).toMatch(
      /\.electron-macos \[data-slot="sidebar-wrapper"\] \{\s*--workspace-titlebar-content-left: 90px;/,
    );
  });
});
