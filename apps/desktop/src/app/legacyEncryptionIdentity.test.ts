import { describe, expect, it } from "vite-plus/test";
import { configureLegacyEncryptionIdentity } from "./legacyEncryptionIdentity.ts";

function fixture(name: string, isPackaged: boolean, ready = false) {
  let currentName = name;
  const writes: string[] = [];
  return {
    isPackaged,
    getName: () => currentName,
    isReady: () => ready,
    setName: (value: string) => {
      currentName = value;
      writes.push(value);
    },
    writes,
  };
}

describe("native encryption identity bridge", () => {
  it("retains packaged encryption identity without preventing later display branding", () => {
    const app = fixture("upcomputer", true);
    configureLegacyEncryptionIdentity(app);
    expect(app.getName()).toBe("t3code");
    app.setName("Up.computer (Alpha)");
    expect(app.getName()).toBe("Up.computer (Alpha)");
  });
  it("retains the old workspace identity for source desktop development", () => {
    const app = fixture("@upcomputer/desktop", false);
    configureLegacyEncryptionIdentity(app);
    expect(app.getName()).toBe("@t3tools/desktop");
  });
  it("does not change independent Electron fixtures", () => {
    const app = fixture("Electron", false);
    configureLegacyEncryptionIdentity(app);
    expect(app.writes).toEqual([]);
  });
  it("refuses late configuration rather than pretending the context was changed", () => {
    const app = fixture("upcomputer", true, true);
    expect(() => configureLegacyEncryptionIdentity(app)).toThrow("before Electron readiness");
    expect(app.writes).toEqual([]);
  });
});
