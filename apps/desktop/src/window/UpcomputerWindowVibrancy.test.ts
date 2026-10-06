import { describe, expect, it } from "vite-plus/test";

import {
  upcomputerWindowBackgroundColor,
  upcomputerWindowVibrancyOptions,
} from "./UpcomputerWindowVibrancy.ts";

describe("Up.computer window vibrancy", () => {
  it("creates the macOS window transparent over the active sidebar material", () => {
    expect(upcomputerWindowVibrancyOptions("darwin")).toEqual({
      backgroundColor: "#00000000",
      transparent: true,
      vibrancy: "sidebar",
      visualEffectState: "active",
    });
    expect(upcomputerWindowBackgroundColor("darwin", "#fefefe")).toBe("#00000000");
  });

  it("leaves the opaque window on every other platform", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(upcomputerWindowVibrancyOptions(platform)).toBeNull();
      expect(upcomputerWindowBackgroundColor(platform, "#131313")).toBe("#131313");
    }
  });
});
