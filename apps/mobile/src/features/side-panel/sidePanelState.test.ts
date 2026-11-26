import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SIDE_PANEL,
  closeSidePanelTab,
  openSidePanelSurface,
  readSidePanel,
  setSidePanelTerminal,
  updateSidePanel,
} from "./sidePanelState";

describe("side panel tabs", () => {
  it("opens each view once and shows its tab when opened again", () => {
    const two = openSidePanelSurface(openSidePanelSurface(EMPTY_SIDE_PANEL, "files"), "diff");
    expect(two).toEqual({ tabs: [{ id: "files" }, { id: "diff" }], active: "diff" });
    const again = openSidePanelSurface({ ...two, active: null }, "files");
    expect(again).toEqual({ tabs: two.tabs, active: "files" });
  });

  it("closing the tab on screen shows its right neighbour, then its left, then the new tab", () => {
    const three = ["files", "diff", "terminal"].reduce(
      (state, surface) => openSidePanelSurface(state, surface as "files"),
      EMPTY_SIDE_PANEL,
    );
    const middle = closeSidePanelTab({ ...three, active: "diff" }, "diff");
    expect(middle.active).toBe("terminal");
    const last = closeSidePanelTab(middle, "terminal");
    expect(last).toEqual({ tabs: [{ id: "files" }], active: "files" });
    expect(closeSidePanelTab(last, "files")).toEqual(EMPTY_SIDE_PANEL);
    expect(closeSidePanelTab({ ...three, active: "files" }, "terminal").active).toBe("files");
  });

  it("keeps a Terminal tab's shell and each chat's tabs apart", () => {
    const terminal = setSidePanelTerminal(
      openSidePanelSurface(EMPTY_SIDE_PANEL, "terminal"),
      "term-2",
    );
    expect(terminal.tabs).toEqual([{ id: "terminal", terminalId: "term-2" }]);
    updateSidePanel("env:a", (state) => openSidePanelSurface(state, "tasks"));
    expect(readSidePanel("env:a").active).toBe("tasks");
    expect(readSidePanel("env:b")).toBe(EMPTY_SIDE_PANEL);
  });
});
