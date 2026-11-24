import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { freeAgentSetupFor } from "./FreeAgentSetup.ts";

const provider = (
  driver: string,
  overrides: Partial<Pick<ServerProvider, "enabled" | "installed" | "status" | "statusPending">> & {
    readonly auth?: ServerProvider["auth"]["status"];
    readonly instanceId?: string;
  } = {},
): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(overrides.instanceId ?? driver),
    driver: ProviderDriverKind.make(driver),
    enabled: overrides.enabled ?? true,
    installed: overrides.installed ?? true,
    status: overrides.status ?? "ready",
    ...(overrides.statusPending === undefined ? {} : { statusPending: overrides.statusPending }),
    auth: { status: overrides.auth ?? "authenticated" },
  }) as unknown as ServerProvider;

describe("freeAgentSetupFor", () => {
  it("is on while OpenCode is the only agent that works", () => {
    const setup = freeAgentSetupFor([
      provider("opencode"),
      provider("claudeAgent", { installed: false, status: "warning", auth: "unknown" }),
      provider("codex", { auth: "unauthenticated" }),
      provider("cursor", { enabled: false }),
    ]);
    expect(setup.active).toBe(true);
    expect(setup.freeAgentInstanceIds).toEqual(["opencode"]);
  });

  it("is off once another agent works", () => {
    expect(freeAgentSetupFor([provider("opencode"), provider("codex")]).active).toBe(false);
  });

  it("is off while an installed agent's first check is still out", () => {
    // A user's own agent never gets setup steps at launch.
    expect(
      freeAgentSetupFor([
        provider("opencode"),
        provider("claudeAgent", { statusPending: true, status: "warning", auth: "unknown" }),
      ]).active,
    ).toBe(false);
  });

  it("lists every OpenCode instance as the free agent", () => {
    expect(
      freeAgentSetupFor([
        provider("opencode"),
        provider("opencode", { instanceId: "opencode_work" }),
        provider("codex", { auth: "unauthenticated" }),
      ]).freeAgentInstanceIds,
    ).toEqual(["opencode", "opencode_work"]);
  });
});
