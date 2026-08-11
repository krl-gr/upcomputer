import { describe, expect, it } from "vite-plus/test";

import { getElectronPlatformClassNames } from "./windowControlsOverlay";

describe("getElectronPlatformClassNames", () => {
  it("marks macOS Electron so collapsed workspace titlebars reserve the traffic-light inset", () => {
    expect(getElectronPlatformClassNames("MacIntel")).toEqual(["electron", "electron-macos"]);
  });

  it("keeps Windows on its window-controls overlay class", () => {
    expect(getElectronPlatformClassNames("Win32")).toEqual(["electron", "electron-windows"]);
  });

  it("does not apply a native-control platform inset to other Electron hosts", () => {
    expect(getElectronPlatformClassNames("Linux x86_64")).toEqual(["electron"]);
  });
});
