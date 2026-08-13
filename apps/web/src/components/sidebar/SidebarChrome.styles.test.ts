// @effect-diagnostics nodeBuiltinImport:off - This regression test inspects the shared chrome markup.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const sidebarChromeSource = NodeFS.readFileSync(
  new URL("./SidebarChrome.tsx", import.meta.url),
  "utf8",
);

describe("sidebar chrome presentation", () => {
  it("uses the standard sidebar row hover contract for Settings", () => {
    expect(sidebarChromeSource).toContain("hover:bg-sidebar-row-hover");
    expect(sidebarChromeSource).toContain("hover:text-sidebar-foreground");
    expect(sidebarChromeSource).not.toContain("hover:bg-accent");
  });
});
