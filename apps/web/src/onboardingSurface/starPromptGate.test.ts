import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  realAgentConnected,
  setStarPromptProviderReader,
  starPromptWaitsForRealAgent,
} from "./starPromptGate";

function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-24T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("realAgentConnected", () => {
  it("waits for a working agent other than the free agent", () => {
    expect(realAgentConnected(undefined)).toBe(false);
    expect(realAgentConnected([provider("opencode")])).toBe(false);
    expect(realAgentConnected([provider("opencode"), provider("codex", { enabled: false })])).toBe(
      false,
    );
    expect(
      realAgentConnected([provider("claudeAgent", { auth: { status: "unauthenticated" } })]),
    ).toBe(false);
    expect(realAgentConnected([provider("opencode"), provider("codex")])).toBe(true);
  });
});

describe("starPromptWaitsForRealAgent", () => {
  it("holds the star prompt while only the free agent works, and never without a reader", () => {
    const environmentId = EnvironmentId.make("env");
    let providers = [provider("opencode")];
    expect(starPromptWaitsForRealAgent(environmentId)).toBe(false);
    setStarPromptProviderReader(() => providers);
    expect(starPromptWaitsForRealAgent(environmentId)).toBe(true);
    providers = [provider("opencode"), provider("codex")];
    expect(starPromptWaitsForRealAgent(environmentId)).toBe(false);
    setStarPromptProviderReader(null);
  });
});
