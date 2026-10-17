import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const surface = vi.hoisted(() => ({ variant: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => surface.variant,
}));

import type { ProviderInstanceEntry } from "../providerInstances";
import {
  composerProviderSetupInstanceId,
  countReadyOnboardingProviders,
  isCodexExistingCliChosen,
  resolveAgentInstallCell,
  resolveAgentReadyCell,
  resolveCliInstallCommand,
  resolveCliLoginCommand,
  showsUpComputerOnboarding,
  UPCOMPUTER_ONBOARDING_AGENTS,
} from "./upComputerOnboarding.logic";

afterEach(() => {
  surface.variant = "upcomputer";
});

function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-17T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const missing = { installed: false, status: "error", auth: { status: "unknown" } } as const;
const signedOut = { status: "error", auth: { status: "unauthenticated" } } as const;

describe("showsUpComputerOnboarding", () => {
  const environmentId = EnvironmentId.make("env");

  it("shows our screens on a paired server with the upcomputer surface", () => {
    expect(showsUpComputerOnboarding({ localAvailable: true, environmentId })).toBe(true);
  });

  it("keeps upstream's wizard for hosted web, a missing server, or the upstream surface", () => {
    expect(showsUpComputerOnboarding({ localAvailable: false, environmentId })).toBe(false);
    expect(showsUpComputerOnboarding({ localAvailable: true, environmentId: undefined })).toBe(
      false,
    );
    surface.variant = "upstream";
    expect(showsUpComputerOnboarding({ localAvailable: true, environmentId })).toBe(false);
  });
});

describe("agent rows", () => {
  const agent = (driver: string) =>
    UPCOMPUTER_ONBOARDING_AGENTS.find((candidate) => candidate.driver === driver)!;
  const cells = (
    driver: string,
    snapshot: ServerProvider | undefined,
    codexExistingCli = false,
  ) => [
    resolveAgentInstallCell({ agent: agent(driver), provider: snapshot, codexExistingCli }),
    resolveAgentReadyCell({ agent: agent(driver), provider: snapshot, codexExistingCli }),
  ];

  it("offers V1's six agents in V1's order", () => {
    expect(UPCOMPUTER_ONBOARDING_AGENTS.map((entry) => entry.name)).toEqual([
      "Codex",
      "Claude",
      "Cursor",
      "Grok",
      "OpenCode",
      "Antigravity",
    ]);
    for (const entry of UPCOMPUTER_ONBOARDING_AGENTS) expect(entry.description).not.toContain("—");
  });

  it("needs no install step for Codex until the user picks the CLI", () => {
    const codex = provider("codex", missing);
    expect(cells("codex", codex)).toEqual(["included", "connect"]);
    expect(cells("codex", codex, true)).toEqual(["install", "install-first"]);
    expect(cells("codex", provider("codex", signedOut), true)).toEqual(["installed", "sign-in"]);
  });

  it("walks CLI agents through install, then sign-in, then ready", () => {
    for (const driver of ["claudeAgent", "grok", "opencode"]) {
      expect(cells(driver, provider(driver, missing))).toEqual(["install", "install-first"]);
      expect(cells(driver, provider(driver, signedOut))).toEqual(["installed", "sign-in"]);
      expect(cells(driver, provider(driver))).toEqual(["installed", "ready"]);
    }
  });

  it("connects agents with in-app setup in one step", () => {
    expect(cells("cursor", provider("cursor", signedOut))).toEqual(["built-in", "connect"]);
    expect(cells("antigravity", provider("antigravity", missing))).toEqual(["install", "connect"]);
  });

  it("offers Connect for an agent that starts disabled", () => {
    expect(cells("grok", provider("grok", { ...missing, enabled: false }))[1]).toBe("connect");
    expect(cells("cursor", provider("cursor", { enabled: false, status: "disabled" }))[1]).toBe(
      "connect",
    );
  });

  it("waits while the server has not reported the agent", () => {
    expect(cells("codex", undefined)).toEqual(["checking", "checking"]);
  });
});

describe("CLI commands", () => {
  it("runs OpenCode's official installer unchanged", () => {
    expect(resolveCliInstallCommand("opencode", "darwin")).toBe(
      "curl -fsSL https://opencode.ai/install | bash",
    );
    expect(resolveCliInstallCommand("grok", "linux")).toBe("npm install -g @xai-official/grok");
  });

  it("logs in through a configured binary only when it needs no quoting", () => {
    expect(resolveCliLoginCommand("grok", {})).toBe("grok login");
    expect(resolveCliLoginCommand("opencode", { binaryPath: "~/bin/opencode" })).toBe(
      "~/bin/opencode auth login",
    );
    expect(resolveCliLoginCommand("grok", { binaryPath: "/Apps/My Grok/grok" })).toBe("grok login");
  });
});

describe("isCodexExistingCliChosen", () => {
  it("is true only for an explicit choice of the CLI", () => {
    expect(isCodexExistingCliChosen({ setupMode: "existing" })).toBe(true);
    expect(isCodexExistingCliChosen({ setupMode: "managed" })).toBe(false);
    expect(isCodexExistingCliChosen({})).toBe(false);
    expect(isCodexExistingCliChosen(null)).toBe(false);
  });
});

describe("countReadyOnboardingProviders", () => {
  it("counts enabled, working agents of any driver", () => {
    expect(
      countReadyOnboardingProviders([
        provider("codex"),
        provider("claudeAgent", signedOut),
        provider("cursor", { enabled: false }),
        provider("opencode"),
      ]),
    ).toBe(2);
    expect(countReadyOnboardingProviders(null)).toBe(0);
  });
});

describe("composerProviderSetupInstanceId", () => {
  function entry(snapshot: ServerProvider): ProviderInstanceEntry {
    return {
      instanceId: snapshot.instanceId,
      driverKind: snapshot.driver,
      displayName: snapshot.driver,
      enabled: snapshot.enabled,
      installed: snapshot.installed,
      status: snapshot.status,
      isDefault: true,
      isAvailable: false,
      snapshot,
      models: [],
    };
  }
  const cursor = entry(
    provider("cursor", { ...missing, setup: { canAuthenticate: true, canInstall: false } }),
  );

  it("leads a clean Mac to Codex, not to Cursor that nobody installed", () => {
    const entries = [
      cursor,
      entry(provider("codex", missing)),
      entry(provider("claudeAgent", missing)),
    ];
    expect(composerProviderSetupInstanceId(entries)).toBe("codex");
  });

  it("leads to the agent the user installed but has not signed in to", () => {
    const entries = [
      cursor,
      entry(provider("codex", missing)),
      entry(provider("claudeAgent", signedOut)),
    ];
    expect(composerProviderSetupInstanceId(entries)).toBe("claudeAgent");
  });

  it("keeps upstream's first provider with in-app setup on the upstream surface", () => {
    surface.variant = "upstream";
    const entries = [entry(provider("codex", missing)), cursor];
    expect(composerProviderSetupInstanceId(entries)).toBe("cursor");
  });
});
