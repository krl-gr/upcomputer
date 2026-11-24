import {
  EnvironmentId,
  type FirstRunAgentFailureReason,
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
  noAgentScreenClosesForAgent,
  noAgentScreenFreeAgentReady,
  noAgentScreenPlace,
  noAgentScreenShownDetails,
  resolveFirstRunAgentAutoRetry,
  resolveFirstRunAgentStart,
  resolveFirstRunAgentStartupFailure,
  resolveFirstRunAgentStatus,
  firstRunAgentRetrying,
  resolveNoAgentScreenInstallView,
} from "./upComputerOnboarding.logic";
import { asksAgainForAgent } from "./noAgentScreenRecord";

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

  const pending = { statusPending: true, ...missing } as const;

  it("asks first on a Mac with none of the user's agents installed", () => {
    expect(
      decide([
        provider("codex", missing),
        provider("claudeAgent", missing),
        provider("opencode", { enabled: false }),
      ]),
    ).toBe("ask");
    // Turned off in settings is not one of the user's agents; OpenCode is what setup installs.
    expect(decide([provider("claudeAgent", { enabled: false })])).toBe("ask");
    expect(decide([provider("codex", missing), provider("opencode", missing)])).toBe("ask");
    // A driver's placeholder before its first check, which says installed with nothing found yet.
    const placeholder = { version: null, status: "warning", auth: { status: "unknown" } } as const;
    expect(decide([provider("kiro", placeholder), provider("codex", missing)])).toBe("ask");
  });

  it("keeps installing by itself when an agent of the user's is installed but does not work", () => {
    expect(
      decide([
        provider("codex", missing),
        provider("claudeAgent", signedOut),
        provider("opencode", { enabled: false }),
      ]),
    ).toBe("install");
    expect(decide([provider("codex", { status: "error" })])).toBe("install");
  });

  it("keeps a working agent of the user's and downloads nothing", () => {
    expect(decide([provider("codex", missing), provider("claudeAgent")])).toBe("skip");
    expect(decide([provider("claudeAgent")], true)).toBe("skip");
    expect(decide([provider("claudeAgent", pending), provider("codex")])).toBe("skip");
  });

  it("waits for the first checks, but not past the wait", () => {
    expect(decide(null)).toBe("wait");
    expect(decide([provider("claudeAgent", pending)])).toBe("wait");
    expect(decide([provider("claudeAgent", pending)], true)).toBe("ask");
    expect(decide([provider("claudeAgent", pending), provider("codex", signedOut)], true)).toBe(
      "install",
    );
    expect(decide(null, true)).toBe("ask");
    expect(decide([provider("opencode", { statusPending: true })])).toBe("ask");
  });
});

describe("first-run agent start latch", () => {
  const working = [provider("codex"), provider("opencode", { enabled: false })];
  const latch = (
    latched: Parameters<typeof latchFirstRunAgentStart>[0]["latched"],
    providers: ReadonlyArray<ServerProvider> | null,
    completed = false,
    askAgain = false,
  ) => latchFirstRunAgentStart({ latched, completed, askAgain, providers, waitOver: false });

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
    expect(latch(null, [provider("codex", signedOut)], true, true)).toBe("skip");
  });

  it("asks again on a later launch for a user who left the screen without a working agent", () => {
    expect(latch(null, [provider("codex", missing)], true, true)).toBe("ask");
    expect(latch(null, [provider("codex", missing)], false, true)).toBe("ask");
    expect(latch(null, working, true, true)).toBe("skip");
    expect(latch(null, [provider("claudeAgent", { statusPending: true })], true, true)).toBeNull();
  });

  it("keeps an install decision, and decides nothing while the checks run", () => {
    expect(latch(null, [provider("claudeAgent", { statusPending: true })])).toBeNull();
    expect(latch(null, [provider("codex", signedOut)])).toBe("install");
    expect(latch("install", working)).toBe("install");
    expect(latch("ask", working)).toBe("ask");
  });
});

describe("no-agent screen", () => {
  const view = (input: Partial<Parameters<typeof resolveNoAgentScreenInstallView>[0]>) =>
    resolveNoAgentScreenInstallView({ status: null, installed: false, retrying: false, ...input });
  const preparing = (progress: number | null, slow = false) =>
    ({ kind: "preparing", progress, slow }) as const;
  const failed = (reason: FirstRunAgentFailureReason) =>
    ({ kind: "failed", message: "", reason }) as const;
  const installing = (phase: string, progress: number | null = null) => ({
    kind: "installing",
    phase,
    progress,
  });

  it("shows the download, then the start, then still starting", () => {
    expect(view({ status: preparing(null) })).toEqual(installing("downloading"));
    expect(view({ status: preparing(0.42) })).toEqual(installing("downloading", 0.42));
    expect(view({ status: preparing(null), installed: true })).toEqual(installing("starting"));
    expect(view({ status: preparing(null, true), installed: true })).toEqual(installing("slow"));
  });

  it("shows trying again from Try again until progress reports", () => {
    expect(view({ status: failed("install"), retrying: true })).toEqual(installing("retrying"));
    expect(view({ status: preparing(null), retrying: true })).toEqual(installing("retrying"));
    expect(view({ status: preparing(0), retrying: true })).toEqual(installing("retrying"));
    // The first bytes would still read "Downloading… 0%".
    expect(view({ status: preparing(0.004), retrying: true })).toEqual(installing("retrying"));
    expect(view({ status: preparing(0.1), retrying: true })).toEqual(
      installing("downloading", 0.1),
    );
    expect(view({ status: preparing(null), installed: true, retrying: true })).toEqual(
      installing("retrying"),
    );
  });

  it("holds Try again on a failed install until the new download reads 1%", () => {
    const install = (operationId: string, overrides: Partial<ProviderInstallState> = {}) =>
      ({
        driver: ProviderDriverKind.make("opencode"),
        operationId,
        phase: "downloading",
        downloadedBytes: 0,
        totalBytes: 100,
        version: null,
        installedVersion: null,
        canRemove: false,
        message: null,
        ...overrides,
      }) as ProviderInstallState;
    const retrying = (input: Partial<Parameters<typeof firstRunAgentRetrying>[0]>) =>
      firstRunAgentRetrying({
        requestRunning: false,
        retriedInstallId: "failed",
        startError: null,
        install: install("failed", { phase: "failed" }),
        ...input,
      });
    expect(retrying({ requestRunning: true, retriedInstallId: undefined })).toBe(true);
    // The request answered before the install state moved on from the failure.
    expect(retrying({})).toBe(true);
    expect(retrying({ install: install("next") })).toBe(true);
    expect(retrying({ install: install("next", { downloadedBytes: 4, totalBytes: 1000 }) })).toBe(
      true,
    );
    expect(retrying({ install: install("next", { downloadedBytes: 1 }) })).toBe(false);
    expect(retrying({ install: install("next", { phase: "failed" }) })).toBe(false);
    expect(retrying({ startError: "Could not start" })).toBe(false);
    // Not after a first install, and not once OpenCode is installed.
    expect(retrying({ retriedInstallId: undefined, install: install("next") })).toBe(false);
  });

  it("tells three failures apart, and reads the rest as no answer", () => {
    const reasons: ReadonlyArray<[FirstRunAgentFailureReason, string]> = [
      ["install", "install"],
      ["models_missing", "models"],
      ["startup_timeout", "timeout"],
      ["auth", "timeout"],
      ["migration", "timeout"],
      ["unknown", "timeout"],
    ];
    for (const [reason, shown] of reasons) {
      expect(view({ status: failed(reason), installed: reason !== "install" })).toEqual({
        kind: "failed",
        reason: shown,
      });
    }
  });

  it("closes for the user's own agent at any time, and for OpenCode only while its install shows", () => {
    const openCodeReady = [provider("codex", missing), provider("opencode")];
    expect(noAgentScreenClosesForAgent(openCodeReady, true)).toBe(true);
    expect(noAgentScreenClosesForAgent(openCodeReady, false)).toBe(false);
    expect(noAgentScreenClosesForAgent([provider("claudeAgent")], false)).toBe(true);
    expect(noAgentScreenClosesForAgent([provider("claudeAgent", { enabled: false })], true)).toBe(
      false,
    );
    expect(noAgentScreenClosesForAgent([provider("opencode", { statusPending: true })], true)).toBe(
      false,
    );
  });

  it("offers the free agent as ready once OpenCode works", () => {
    expect(noAgentScreenFreeAgentReady(undefined)).toBe(false);
    expect(noAgentScreenFreeAgentReady([provider("codex", missing)])).toBe(false);
    expect(noAgentScreenFreeAgentReady([provider("opencode", { statusPending: true })])).toBe(
      false,
    );
    expect(noAgentScreenFreeAgentReady([provider("opencode", { enabled: false })])).toBe(false);
    expect(noAgentScreenFreeAgentReady([provider("codex", missing), provider("opencode")])).toBe(
      true,
    );
  });

  it("reports what the checks found when it shows", () => {
    expect(
      noAgentScreenShownDetails([
        provider("codex", missing),
        provider("claudeAgent", { statusPending: true, ...missing }),
        provider("opencode"),
      ]),
    ).toEqual({ installedAgents: 0, signedOutAgents: 0, checksTimedOut: true });
    expect(noAgentScreenShownDetails([provider("codex", signedOut)])).toEqual({
      installedAgents: 1,
      signedOutAgents: 1,
      checksTimedOut: false,
    });
  });

  it("names the machine the agents belong to", () => {
    const place = (os: "darwin" | "windows" | "linux" | null, local = true) =>
      noAgentScreenPlace({ os, local, environmentLabel: local ? null : "Studio" });
    expect(place("darwin")).toEqual({ kind: "mac" });
    expect(place("windows")).toEqual({ kind: "pc" });
    expect(place("linux")).toEqual({ kind: "computer" });
    expect(place(null)).toEqual({ kind: "computer" });
    expect(place("darwin", false)).toEqual({ kind: "remote", name: "Studio" });
    expect(noAgentScreenPlace({ os: "darwin", local: false, environmentLabel: null })).toEqual({
      kind: "computer",
    });
  });

  it("comes back on the next launch until an agent worked", () => {
    expect(asksAgainForAgent(null)).toBe(false);
    expect(asksAgainForAgent({ shownAt: 1, path: "setup_myself", agentWorked: false })).toBe(true);
    expect(asksAgainForAgent({ shownAt: 1, path: "copied_prompt", agentWorked: false })).toBe(true);
    expect(asksAgainForAgent({ shownAt: 1, path: null, agentWorked: true })).toBe(false);
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
