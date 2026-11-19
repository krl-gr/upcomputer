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
  firstRunWorkspaceProjects,
  FIRST_RUN_AGENT_SLOW_START_MS,
  FIRST_RUN_AGENT_START_TIMEOUT_MS,
  firstRunAgentStartupPhase,
  type FirstRunAgentStartup,
  isFirstRunAgentChecking,
  latchFirstRunAgentStart,
  resolveFirstRunAgentAutoRetry,
  resolveFirstRunAgentStart,
  resolveFirstRunAgentStartupFailure,
  resolveFirstRunAgentStatus,
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
  const startup = (overrides: Partial<FirstRunAgentStartup> = {}): FirstRunAgentStartup => ({
    operationId: "operation",
    attempt: 0,
    startedAt: 0,
    retriedCheckedAt: null,
    phase: "starting",
    automatic: false,
    sawEnabled: false,
    ...overrides,
  });
  const status = (input: Partial<Parameters<typeof resolveFirstRunAgentStatus>[0]>) =>
    resolveFirstRunAgentStatus({
      requested: true,
      startError: null,
      install: null,
      provider: undefined,
      startup: null,
      starterRunning: false,
      autoRetry: { kind: "off" },
      ...input,
    });
  const openCode = (overrides: Partial<ServerProvider> = {}) => provider("opencode", overrides);
  const done = install({ phase: "succeeded" });
  const preparing = { kind: "preparing", progress: null, slow: false };

  it("prepares from the first frame of a requested setup, before the server answers", () => {
    expect(status({})).toEqual(preparing);
    expect(status({ install: install({ phase: "idle" }) })).toEqual(preparing);
    expect(status({ requested: false, install: install({ phase: "idle" }) })).toBeNull();
  });

  it("reports download progress, then waits for the turned-on agent to answer", () => {
    expect(status({ install: install({ downloadedBytes: 25, totalBytes: 100 }) })).toEqual({
      kind: "preparing",
      progress: 0.25,
      slow: false,
    });
    expect(status({ install: install({ phase: "verifying" }) })).toEqual({
      kind: "preparing",
      progress: 1,
      slow: false,
    });
    expect(
      status({ install: done, provider: openCode({ enabled: false }), startup: startup() }),
    ).toEqual(preparing);
    expect(status({ install: done, provider: openCode({ statusPending: true }) })).toEqual(
      preparing,
    );
    expect(status({ install: done, provider: openCode(), startup: startup() })).toBeNull();
  });

  it("always shows a status while the installed agent starts: starting, slow, then timed out", () => {
    const pending = openCode({ statusPending: true });
    for (const provider of [pending, openCode({ enabled: false }), undefined]) {
      expect(status({ install: done, provider, startup: startup() })).toEqual(preparing);
      expect(status({ install: done, provider, startup: startup({ phase: "slow" }) })).toEqual({
        ...preparing,
        slow: true,
      });
      expect(status({ install: done, provider, startup: startup({ phase: "timedOut" }) })).toEqual({
        kind: "failed",
        message: "Your agent is taking too long to start.",
        reason: "startup_timeout",
      });
    }
    expect(
      status({ install: done, provider: openCode(), startup: startup({ phase: "timedOut" }) }),
    ).toBeNull();
    expect(firstRunAgentStartupPhase(FIRST_RUN_AGENT_SLOW_START_MS - 1)).toBe("starting");
    expect(firstRunAgentStartupPhase(FIRST_RUN_AGENT_SLOW_START_MS)).toBe("slow");
    expect(firstRunAgentStartupPhase(FIRST_RUN_AGENT_START_TIMEOUT_MS)).toBe("timedOut");
  });

  it("keeps setup on from the first render that sees the install succeed", () => {
    const disabled = openCode({ enabled: false });
    expect(status({ install: done, provider: disabled, starterRunning: true })).toEqual(preparing);
    expect(
      status({ install: done, provider: disabled, startup: startup({ operationId: "earlier" }) }),
    ).toBeNull();
    expect(status({ install: done, provider: undefined })).toBeNull();
  });

  it("falls back to the normal composer once OpenCode, which worked, is off", () => {
    const worked = startup({ phase: "ready" });
    expect(
      status({ install: done, provider: openCode({ enabled: false }), startup: worked }),
    ).toBeNull();
    expect(
      status({ install: done, provider: openCode({ status: "disabled" }), startup: worked }),
    ).toBeNull();
    expect(
      status({ install: done, provider: openCode({ statusPending: true }), startup: worked }),
    ).toEqual(preparing);
  });

  it("fails with a reason: the install's, or the agent's own when it will not start", () => {
    expect(
      status({ install: install({ phase: "failed", message: "Check your connection." }) }),
    ).toEqual({ kind: "failed", message: "Check your connection.", reason: "install" });
    expect(status({ startError: "Could not start." })).toEqual({
      kind: "failed",
      message: "Could not start.",
      reason: "install",
    });
    const failed = (overrides: Partial<ServerProvider>) =>
      status({ install: done, provider: openCode(overrides), startup: startup() });
    expect(
      failed({ status: "error", message: "OpenCode crashed.", statusReason: "migration" }),
    ).toEqual({
      kind: "failed",
      message: "OpenCode crashed.",
      reason: "migration",
    });
    expect(failed({ status: "warning", statusReason: "models_missing" })).toMatchObject({
      reason: "models_missing",
    });
    expect(failed(signedOut)).toMatchObject({ reason: "auth" });
    expect(failed(missing)).toMatchObject({ reason: "unknown" });
  });

  it("shows a Retry as starting again until OpenCode answers it", () => {
    const failing = openCode({ status: "error", checkedAt: "2026-10-17T00:00:01.000Z" });
    const retried = startup({ attempt: 1, retriedCheckedAt: failing.checkedAt });
    expect(status({ install: done, provider: failing, startup: retried })).toEqual(preparing);
    expect(
      status({
        install: done,
        provider: { ...failing, checkedAt: "2026-10-17T00:00:09.000Z" },
        startup: retried,
      }),
    ).toMatchObject({ kind: "failed", reason: "unknown" });
  });

  it("lets a retry's download replace an earlier start failure", () => {
    expect(status({ startError: "Could not start.", install: install({}) })).toEqual(preparing);
    expect(
      status({ startError: "Could not start.", install: install({ phase: "failed" }) }),
    ).toMatchObject({ message: "Could not start." });
  });

  it("takes OpenCode turned off during its first start as the user's choice, not a failure", () => {
    const off = openCode({ enabled: false, status: "disabled" });
    const sawOn = startup({ sawEnabled: true, phase: "timedOut" });
    expect(status({ install: done, provider: off, startup: sawOn })).toBeNull();
    expect(
      resolveFirstRunAgentStartupFailure({ install: done, provider: off, startup: sawOn }),
    ).toBeNull();
    // Before the server first turned it on, off is only the snapshot from before the install.
    expect(status({ install: done, provider: off, startup: startup() })).toEqual(preparing);
  });

  describe("automatic retry", () => {
    const available = { kind: "available" } as const;
    const failedInstall = install({ phase: "failed", message: "Check your connection." });
    const timedOut = startup({ phase: "timedOut" });
    const crashed = openCode({ status: "error", statusReason: "unknown" });
    const run = (input: Partial<Parameters<typeof resolveFirstRunAgentAutoRetry>[0]>) =>
      resolveFirstRunAgentAutoRetry({
        requested: true,
        startError: null,
        install: null,
        provider: undefined,
        startup: null,
        starterRunning: true,
        autoRetry: available,
        ...input,
      });

    it("retries a failed download or start once, and shows it as still starting", () => {
      expect(run({ install: failedInstall })).toBe("install");
      expect(run({ startError: "Could not start." })).toBe("install");
      expect(run({ install: done, startup: timedOut })).toBe("start");
      expect(run({ install: done, provider: crashed, startup: startup() })).toBe("start");
      expect(status({ install: failedInstall, autoRetry: available })).toEqual(preparing);
      expect(status({ install: done, startup: timedOut, autoRetry: available })).toEqual({
        ...preparing,
        slow: true,
      });
      expect(status({ install: done, startup: startup({ automatic: true }) })).toEqual({
        ...preparing,
        slow: true,
      });
    });

    it("leaves a sign-in or a missing model list to the user", () => {
      for (const provider of [
        openCode(signedOut),
        openCode({ status: "warning", statusReason: "models_missing" }),
      ]) {
        expect(run({ install: done, provider, startup: startup() })).toBeNull();
        expect(
          status({ install: done, provider, startup: startup(), autoRetry: available }),
        ).toMatchObject({ kind: "failed" });
      }
    });

    it("offers Retry once the automatic attempt fails too", () => {
      const used = { kind: "used", failedInstallId: "operation" } as const;
      expect(run({ install: failedInstall, autoRetry: used })).toBeNull();
      // Until the server replaces the install it retried, that failure is the old one.
      expect(status({ install: failedInstall, autoRetry: used })).toEqual(preparing);
      expect(
        status({ install: { ...failedInstall, operationId: "second" }, autoRetry: used }),
      ).toMatchObject({ kind: "failed", reason: "install" });
      expect(
        status({ install: failedInstall, startError: "Could not start.", autoRetry: used }),
      ).toMatchObject({ kind: "failed", reason: "install" });
      expect(
        status({
          install: done,
          startup: timedOut,
          autoRetry: { kind: "used", failedInstallId: null },
        }),
      ).toMatchObject({ kind: "failed", reason: "startup_timeout" });
    });

    it("waits for the attempt's record, and runs nowhere but the window's own setup", () => {
      expect(run({ install: done, startup: startup({ operationId: "earlier" }) })).toBeNull();
      expect(run({ install: failedInstall, autoRetry: { kind: "off" } })).toBeNull();
      expect(status({ install: failedInstall })).toMatchObject({ kind: "failed" });
    });
  });
});

describe("first-run agent startup failure", () => {
  const done: ProviderInstallState = {
    driver: ProviderDriverKind.make("opencode"),
    operationId: "operation",
    phase: "succeeded",
    downloadedBytes: 0,
    totalBytes: null,
    version: "1.19.3",
    installedVersion: "1.19.3",
    canRemove: false,
    message: null,
  };
  const attempt = (phase: FirstRunAgentStartup["phase"]): FirstRunAgentStartup => ({
    operationId: "operation",
    attempt: 0,
    startedAt: 0,
    retriedCheckedAt: null,
    phase,
    automatic: false,
    sawEnabled: false,
  });
  const failure = (input: Partial<Parameters<typeof resolveFirstRunAgentStartupFailure>[0]>) =>
    resolveFirstRunAgentStartupFailure({
      install: done,
      provider: provider("opencode", { status: "error", statusReason: "migration" }),
      startup: attempt("starting"),
      ...input,
    });

  it("reports an error OpenCode sends after a good install, with its category", () => {
    expect(failure({})).toBe("migration");
    expect(failure({ provider: provider("opencode", signedOut) })).toBe("auth");
  });

  it("reports no answer by the timeout as startup_timeout", () => {
    const pending = provider("opencode", { statusPending: true });
    expect(failure({ provider: pending, startup: attempt("slow") })).toBeNull();
    expect(failure({ provider: pending, startup: attempt("timedOut") })).toBe("startup_timeout");
  });

  it("reports nothing for a working agent, an install failure, or one that worked before", () => {
    expect(failure({ provider: provider("opencode") })).toBeNull();
    expect(failure({ install: { ...done, phase: "failed" } })).toBeNull();
    expect(failure({ startup: null })).toBeNull();
    expect(failure({ startup: { ...attempt("starting"), operationId: "earlier" } })).toBeNull();
    expect(failure({ startup: attempt("ready") })).toBeNull();
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
    // Turned off, signed out, or a recheck that briefly failed: still no download.
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

describe("firstRunWorkspaceProjects", () => {
  const primaryId = EnvironmentId.make("primary");
  const remoteId = EnvironmentId.make("remote");
  const scratch = { environmentId: primaryId, workspaceRoot: "/Users/me/.upcomputer/scratch/" };
  const repo = { environmentId: primaryId, workspaceRoot: "/Users/me/code/app" };
  const remoteScratch = { ...scratch, environmentId: remoteId };

  it("leaves out the scratch project home opens for a new user, and only that one", () => {
    const primary = {
      environmentId: primaryId,
      scratchWorkspaceRoot: "/Users/me/.upcomputer/scratch",
    };
    expect(firstRunWorkspaceProjects([scratch], primary)).toEqual([]);
    expect(firstRunWorkspaceProjects([scratch, repo, remoteScratch], primary)).toEqual([
      repo,
      remoteScratch,
    ]);
    expect(
      firstRunWorkspaceProjects([scratch], {
        environmentId: primaryId,
        scratchWorkspaceRoot: null,
      }),
    ).toEqual([scratch]);
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
