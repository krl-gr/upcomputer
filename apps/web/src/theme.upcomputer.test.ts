// @effect-diagnostics nodeBuiltinImport:off - This regression test inspects the theme source.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const upComputerTheme = NodeFS.readFileSync(
  new URL("./theme.upcomputer.css", import.meta.url),
  "utf8",
);

const SIDEBAR_ROW_TOKEN_NAMES = [
  "--sidebar-row-hover",
  "--sidebar-row-active",
  "--sidebar-row-selected",
  "--sidebar-control-surface",
] as const;

describe("UpComputer scoped sidebar theme", () => {
  it("overrides both rendered sidebar implementations at the scoped element", () => {
    const scopedRuleStart = [
      '[data-upcomputer-sidebar-version="v1"],',
      '[data-upcomputer-sidebar-version="v2"] {',
    ].join("\n");

    expect(upComputerTheme).toContain(scopedRuleStart);
    expect(upComputerTheme).not.toContain('[data-sidebar-version="v1"]');
    for (const token of SIDEBAR_ROW_TOKEN_NAMES) {
      expect(upComputerTheme).toContain(`${token}: var(--sidebar-accent);`);
    }
    expect(upComputerTheme).toContain(
      "--sidebar-muted-foreground: var(--sidebar-accent-foreground);",
    );
  });
});
