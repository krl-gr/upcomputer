import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
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
  isFirstRunAgentChecking,
  latchFirstRunAgentStart,
  resolveAgentInstallCell,
  resolveAgentReadyCell,
  resolveCliInstallCommand,
  resolveCliInstallNote,
  resolveCliLoginCommand,
  resolveFirstRunAgentStart,
  resolveFirstRunAgentStatus,
  resolveFirstRunModel,
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
  });

  it("installs Grok without Node.js except on Windows, where npm needs it", () => {
    expect(resolveCliInstallCommand("grok", "darwin")).toBe(
      "curl -fsSL https://x.ai/cli/install.sh | bash",
    );
    expect(resolveCliInstallNote("darwin")).not.toContain("Node.js");
    expect(resolveCliInstallCommand("grok", "windows")).toBe("npm install -g @xai-official/grok");
    expect(resolveCliInstallNote("windows")).toContain("nodejs.org");
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

describe("first-run agent status", () => {
  const install = (overrides: Partial<ProviderInstallState>): ProviderInstallState => ({
    driver: ProviderDriverKind.make("opencode"),
    operationId: "operation",
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: null,
    version: "1.19.3",
    installedVersion: null,
    canRemove: false,
    message: null,
    ...overrides,
  });
  const status = (input: Partial<Parameters<typeof resolveFirstRunAgentStatus>[0]>) =>
    resolveFirstRunAgentStatus({
      requested: true,
      startError: null,
      install: null,
      provider: undefined,
      activating: false,
      ...input,
    });
  const openCode = (overrides: Partial<ServerProvider> = {}) => provider("opencode", overrides);

  it("prepares from the first frame of a requested setup, before the server answers", () => {
    expect(status({})).toEqual({ kind: "preparing", progress: null });
    expect(status({ install: install({ phase: "idle" }) })).toEqual({
      kind: "preparing",
      progress: null,
    });
    expect(status({ requested: false, install: install({ phase: "idle" }) })).toBeNull();
  });

  it("reports download progress, then waits for the turned-on agent to answer", () => {
    expect(status({ install: install({ downloadedBytes: 25, totalBytes: 100 }) })).toEqual({
      kind: "preparing",
      progress: 0.25,
    });
    expect(status({ install: install({ phase: "verifying" }) })).toEqual({
      kind: "preparing",
      progress: 1,
    });
    const done = install({ phase: "succeeded" });
    expect(
      status({ install: done, provider: openCode({ enabled: false }), activating: true }),
    ).toEqual({ kind: "preparing", progress: null });
    expect(status({ install: done, provider: openCode({ statusPending: true }) })).toEqual({
      kind: "preparing",
      progress: null,
    });
    expect(status({ install: done, provider: openCode() })).toBeNull();
  });

  it("falls back to the normal composer once OpenCode is off past the activation wait", () => {
    const done = install({ phase: "succeeded" });
    expect(status({ install: done, provider: openCode({ enabled: false }) })).toBeNull();
    expect(status({ install: done, provider: openCode({ status: "disabled" }) })).toBeNull();
    expect(status({ install: done, provider: undefined })).toBeNull();
    expect(status({ install: done, provider: undefined, activating: true })).toEqual({
      kind: "preparing",
      progress: null,
    });
  });

  it("fails with the install's own message, or the agent's when it will not start", () => {
    expect(
      status({ install: install({ phase: "failed", message: "Check your connection." }) }),
    ).toEqual({ kind: "failed", message: "Check your connection." });
    expect(status({ startError: "Could not start." })).toEqual({
      kind: "failed",
      message: "Could not start.",
    });
    expect(
      status({
        install: install({ phase: "succeeded" }),
        provider: openCode({ status: "error", message: "OpenCode crashed." }),
      }),
    ).toEqual({ kind: "failed", message: "OpenCode crashed." });
  });

  it("lets a retry's download replace an earlier start failure", () => {
    expect(status({ startError: "Could not start.", install: install({}) })).toEqual({
      kind: "preparing",
      progress: null,
    });
  });
});

describe("first-run agent start", () => {
  const decide = (providers: ReadonlyArray<ServerProvider> | null, waitOver = false) =>
    resolveFirstRunAgentStart({ providers, waitOver });

  it("installs OpenCode on a Mac whose agents have all answered without one that works", () => {
    expect(
      decide([
        provider("codex", missing),
        provider("claudeAgent", signedOut),
        provider("opencode", { enabled: false }),
      ]),
    ).toBe("install");
  });

  it("keeps a working agent of the user's and downloads nothing", () => {
    expect(decide([provider("codex", missing), provider("claudeAgent")])).toBe("skip");
    expect(decide([provider("claudeAgent")], true)).toBe("skip");
    expect(decide([provider("claudeAgent", { enabled: false })])).toBe("install");
  });

  it("waits for the first checks, but not past the wait", () => {
    expect(decide(null)).toBe("wait");
    expect(decide([provider("claudeAgent", { statusPending: true })])).toBe("wait");
    expect(decide([provider("claudeAgent", { statusPending: true })], true)).toBe("install");
    expect(decide(null, true)).toBe("install");
    expect(decide([provider("opencode", { statusPending: true })])).toBe("install");
  });
});

describe("first-run agent start latch", () => {
  const working = [provider("codex"), provider("opencode", { enabled: false })];
  const latch = (
    latched: Parameters<typeof latchFirstRunAgentStart>[0]["latched"],
    providers: ReadonlyArray<ServerProvider> | null,
    completed = false,
  ) => latchFirstRunAgentStart({ latched, completed, providers, waitOver: false });

  it("skips for good once the user's own agent worked, whatever it does later", () => {
    const decided = latch(null, working);
    expect(decided).toBe("skip");
    // Turned off, signed out, or a recheck that briefly failed: still no
    // download, and the starter, which saves a default model only after
    // "install", saves none.
    expect(latch(decided, [provider("codex", { enabled: false }), provider("opencode")])).toBe(
      "skip",
    );
    expect(latch(decided, [provider("codex", signedOut)])).toBe("skip");
    expect(latch(decided, [provider("codex", { status: "error" })])).toBe("skip");
    expect(latch(decided, [])).toBe("skip");
  });

  it("never installs once onboarding is complete", () => {
    expect(latch(null, [provider("codex", missing)], true)).toBe("skip");
  });

  it("keeps an install decision, and decides nothing while the checks run", () => {
    expect(latch(null, [provider("claudeAgent", { statusPending: true })])).toBeNull();
    expect(latch(null, [provider("codex", missing)])).toBe("install");
    expect(latch("install", working)).toBe("install");
  });
});

describe("isFirstRunAgentChecking", () => {
  const entry = (snapshot: ServerProvider): ProviderInstanceEntry => ({
    instanceId: snapshot.instanceId,
    driverKind: snapshot.driver,
    displayName: snapshot.driver,
    enabled: snapshot.enabled,
    installed: snapshot.installed,
    status: snapshot.status,
    isDefault: true,
    isAvailable: true,
    snapshot,
    models: [],
  });

  it("holds the composer only for OpenCode before its first check answers", () => {
    expect(isFirstRunAgentChecking(entry(provider("opencode", { statusPending: true })))).toBe(
      true,
    );
    expect(isFirstRunAgentChecking(entry(provider("opencode")))).toBe(false);
    // Settings turned it on, but the stream still holds the snapshot from while it was off.
    expect(isFirstRunAgentChecking(entry(provider("opencode", { enabled: false })))).toBe(true);
    expect(isFirstRunAgentChecking(entry(provider("opencode", { status: "disabled" })))).toBe(true);
    expect(isFirstRunAgentChecking(entry(provider("claudeAgent", { statusPending: true })))).toBe(
      false,
    );
    expect(isFirstRunAgentChecking(undefined)).toBe(false);
  });
});

describe("first-run model", () => {
  it("prefers GLM-5.3-Flash Free, then the other zero-retention free models", () => {
    expect(resolveFirstRunModel(null)).toBe("opencode/glm-5.3-flash-free");
    expect(
      resolveFirstRunModel([
        "opencode/big-pickle",
        "opencode/minimax-m3.1-flash-free",
        "opencode/glm-5.3-flash-free",
      ]),
    ).toBe("opencode/glm-5.3-flash-free");
    expect(
      resolveFirstRunModel([
        "opencode/minimax-m3.1-flash-free",
        "opencode/deepseek-v4.1-flash-free",
      ]),
    ).toBe("opencode/deepseek-v4.1-flash-free");
    expect(resolveFirstRunModel(["opencode/minimax-m3.1-flash-free"])).toBe(
      "opencode/minimax-m3.1-flash-free",
    );
  });

  it("never falls back to Big Pickle", () => {
    expect(resolveFirstRunModel(["opencode/big-pickle"])).toBeUndefined();
  });
});
