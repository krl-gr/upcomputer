import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../providerInstances";
import { composerModelPickerLabel } from "./composerFooterSurface";

const instanceId = ProviderInstanceId.make("opencode");
const glm = "opencode/glm-5.3-flash-free";

function label(input: {
  readonly statusPending?: boolean;
  readonly options: ReadonlyArray<{ slug: string; name: string; isUnavailable?: boolean }>;
}) {
  const snapshot: ServerProvider = {
    instanceId,
    driver: ProviderDriverKind.make("opencode"),
    enabled: true,
    installed: true,
    version: "1.19.3",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-22T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.statusPending ? { statusPending: true } : {}),
  };
  const entry: ProviderInstanceEntry = {
    instanceId,
    driverKind: snapshot.driver,
    displayName: "OpenCode",
    enabled: true,
    installed: true,
    status: snapshot.status,
    isDefault: true,
    isAvailable: true,
    snapshot,
    models: [],
  };
  return composerModelPickerLabel({
    activeInstanceId: instanceId,
    model: glm,
    instanceEntries: [entry],
    modelOptionsByInstance: new Map([
      [instanceId, input.options.map((option) => ({ ...option, isCustom: false }))],
    ]),
  });
}

describe("composerModelPickerLabel", () => {
  it("names only the provider while its first check has not listed the saved model", () => {
    expect(label({ statusPending: true, options: [] })).toBe("OpenCode");
    expect(
      label({ statusPending: true, options: [{ slug: glm, name: glm, isUnavailable: true }] }),
    ).toBe("OpenCode");
  });

  it("shows the model once listed, and an unlisted one as unavailable after the check", () => {
    expect(label({ options: [{ slug: glm, name: "GLM-5.3-Flash Free" }] })).toBe(
      "OpenCode · GLM-5.3-Flash Free",
    );
    expect(label({ options: [{ slug: glm, name: glm, isUnavailable: true }] })).toBe(
      `OpenCode · ${glm} (Unavailable)`,
    );
  });
});
