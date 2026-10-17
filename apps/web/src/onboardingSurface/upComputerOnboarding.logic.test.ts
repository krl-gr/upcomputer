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
  describeOnboardingAgent,
  isCodexExistingCliChosen,
  resolveAgentInstallCell,
  resolveAgentReadyCell,
  resolveProjectImportOffer,
  showsUpComputerOnboarding,
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
  it("needs no install step for Codex until the user picks the CLI", () => {
    const codex = provider("codex", missing);
    expect(
      resolveAgentInstallCell({ driver: "codex", provider: codex, codexExistingCli: false }),
    ).toBe("included");
    expect(
      resolveAgentInstallCell({ driver: "codex", provider: codex, codexExistingCli: true }),
    ).toBe("install");
    expect(resolveAgentReadyCell({ driver: "codex", provider: codex })).toBe("connect");
  });

  it("walks Claude Code through install, then sign-in, then ready", () => {
    const claude = provider("claudeAgent", missing);
    expect(
      resolveAgentInstallCell({ driver: "claudeAgent", provider: claude, codexExistingCli: false }),
    ).toBe("install");
    expect(resolveAgentReadyCell({ driver: "claudeAgent", provider: claude })).toBe(
      "install-first",
    );

    const installed = provider("claudeAgent", signedOut);
    expect(
      resolveAgentInstallCell({
        driver: "claudeAgent",
        provider: installed,
        codexExistingCli: false,
      }),
    ).toBe("installed");
    expect(resolveAgentReadyCell({ driver: "claudeAgent", provider: installed })).toBe("sign-in");
    expect(
      resolveAgentReadyCell({ driver: "claudeAgent", provider: provider("claudeAgent") }),
    ).toBe("ready");
  });

  it("offers turning a disabled agent on instead of hiding it", () => {
    expect(
      resolveAgentReadyCell({ driver: "codex", provider: provider("codex", { enabled: false }) }),
    ).toBe("enable");
  });

  it("waits while the server has not reported the agent", () => {
    expect(
      resolveAgentInstallCell({ driver: "codex", provider: undefined, codexExistingCli: false }),
    ).toBe("checking");
    expect(resolveAgentReadyCell({ driver: "claudeAgent", provider: undefined })).toBe("checking");
  });

  it("never shows the provider's Settings-oriented message on a first run", () => {
    const codex = provider("codex", {
      ...missing,
      message:
        "Could not start Codex CLI (`codex`). Check Settings → Providers → Codex → Binary path on the server.",
    });
    for (const codexExistingCli of [false, true]) {
      const line = describeOnboardingAgent({ driver: "codex", provider: codex, codexExistingCli });
      expect(line).not.toContain("Binary path");
      expect(line).not.toContain("—");
    }
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

describe("resolveProjectImportOffer", () => {
  const scan = (candidates: number | null, isPending = false) => ({
    data: candidates === null ? null : { candidates: Array.from({ length: candidates }) },
    isPending,
  });

  it("offers import when there is something to import or the scan is still running", () => {
    expect(resolveProjectImportOffer([scan(2)])).toBe("offer");
    expect(resolveProjectImportOffer([scan(null, true)])).toBe("offer");
  });

  it("skips the step when nothing was found or the scan failed", () => {
    expect(resolveProjectImportOffer([scan(0)])).toBe("skip");
    expect(resolveProjectImportOffer([scan(null)])).toBe("skip");
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
