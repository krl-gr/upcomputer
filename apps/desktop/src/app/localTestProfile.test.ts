import { describe, expect, it } from "vite-plus/test";
import { isLocalTestVersion } from "./localTestProfile.ts";

describe("local test profile", () => {
  it("activates only for the explicit localtest prerelease", () => {
    expect(isLocalTestVersion("0.0.31-localtest.1")).toBe(true);
    for (const version of [
      "0.0.31",
      "0.0.31-alpha.1",
      "0.0.31-nightly.1",
      "0.0.31-localtest",
      "localtest",
    ]) {
      expect(isLocalTestVersion(version)).toBe(false);
    }
  });
});
