import { assert, describe, it } from "@effect/vitest";

import { resolveWindowsDisableFeaturesSwitch } from "./UpcomputerWindowsOcclusion.ts";

describe("resolveWindowsDisableFeaturesSwitch", () => {
  it.each([
    { platform: "win32", disableFeatures: null, expected: "CalculateNativeWinOcclusion" },
    {
      platform: "win32",
      disableFeatures: "Vulkan,Foo:param/1",
      expected: "Vulkan,Foo:param/1,CalculateNativeWinOcclusion",
    },
    { platform: "win32", disableFeatures: "Vulkan, *CalculateNativeWinOcclusion", expected: null },
    { platform: "darwin", disableFeatures: null, expected: null },
    { platform: "linux", disableFeatures: "Vulkan", expected: null },
  ] as const)("$platform with $disableFeatures", ({ platform, disableFeatures, expected }) => {
    assert.equal(resolveWindowsDisableFeaturesSwitch({ platform, disableFeatures }), expected);
  });
});
