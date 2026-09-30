import { describe, expect, it } from "vite-plus/test";

import { getProviderVersionLabel } from "./providerStatus";

describe("getProviderVersionLabel", () => {
  it("prefixes plain versions", () => {
    expect(getProviderVersionLabel("1.2.3")).toBe("v1.2.3");
    expect(getProviderVersionLabel("v1.2.3")).toBe("v1.2.3");
    expect(getProviderVersionLabel(null)).toBeNull();
  });

  it("shortens Antigravity release tags", () => {
    expect(getProviderVersionLabel("agy_acp_server_1.1.1")).toBe("v1.1.1");
    expect(getProviderVersionLabel("agy_acp_server_20260818_01_RC01")).toBe("2026-08-18 RC01");
    expect(getProviderVersionLabel("agy_acp_server_20260818_01")).toBe("2026-08-18");
  });
});
