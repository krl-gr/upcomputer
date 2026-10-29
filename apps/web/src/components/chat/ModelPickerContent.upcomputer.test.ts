import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { shouldOfferModelPickerSetup } from "./ModelPickerContent";

function entry(status: ServerProvider["status"], driver = "opencode") {
  return deriveProviderInstanceEntries([
    {
      instanceId: ProviderInstanceId.make(`${driver}_work`),
      driver: ProviderDriverKind.make(driver),
      enabled: true,
      installed: true,
      version: null,
      status,
      auth: { status: "authenticated" },
      checkedAt: "2026-08-28T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ])[0]!;
}

describe("shouldOfferModelPickerSetup", () => {
  it("does not offer setup for a provider whose first check is still running", () => {
    const providerEntry = entry("warning", "antigravity");
    const pending = {
      ...providerEntry,
      installed: false,
      snapshot: {
        ...providerEntry.snapshot,
        installed: false,
        auth: { status: "unknown" as const },
        statusPending: true,
      },
    };
    expect(shouldOfferModelPickerSetup(pending, [])).toBe(false);
    expect(
      shouldOfferModelPickerSetup(
        { ...pending, snapshot: { ...pending.snapshot, statusPending: false } },
        [],
      ),
    ).toBe(true);
  });
});
