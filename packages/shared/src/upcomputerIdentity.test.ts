import { describe, expect, it } from "vite-plus/test";

import { resolveUpcomputerBuildKind } from "./upcomputerIdentity.ts";

describe("resolveUpcomputerBuildKind", () => {
  it("reports every unpackaged run as dev", () => {
    expect(resolveUpcomputerBuildKind({ packaged: false, version: "0.0.37" })).toBe("dev");
    expect(resolveUpcomputerBuildKind({ packaged: false, version: "0.0.37-rc.3" })).toBe("dev");
    expect(resolveUpcomputerBuildKind({ packaged: false, version: "44.4.5" })).toBe("dev");
  });

  it("tells packaged builds apart by version", () => {
    const kind = (version: string) => resolveUpcomputerBuildKind({ packaged: true, version });
    expect(kind("0.0.37")).toBe("stable");
    expect(kind("0.0.37-rc.3")).toBe("rc");
    expect(kind("0.0.37-beta.1")).toBe("rc");
    expect(kind("0.0.37-localtest.25")).toBe("localtest");
    expect(kind("0.0.37-demo.2")).toBe("localtest");
    expect(kind("0.0.41-nightly.20260911.7")).toBe("nightly");
    expect(kind("0.0.41-preview.20260911.7")).toBe("nightly");
  });
});
