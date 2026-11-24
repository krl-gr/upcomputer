// @vitest-environment jsdom
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
  type ServerProvider,
} from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = await vi.hoisted(async () => {
  const { Atom } = await import("effect/reactivity");
  const events: Array<Record<string, unknown>> = [];
  return {
    startInstall: vi.fn(),
    complete: vi.fn(async () => undefined),
    events,
    record: (_environmentId: string, input: Record<string, unknown>) => {
      events.push(input);
    },
    // Kept alive so a test can set them before anything subscribes.
    atoms: {
      providers: Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(Atom.keepAlive),
      install: Atom.make<ProviderInstallState | null>(null).pipe(Atom.keepAlive),
      otherProviders: Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(Atom.keepAlive),
      otherInstall: Atom.make<ProviderInstallState | null>(null).pipe(Atom.keepAlive),
      threads: Atom.make<ReadonlyArray<{ latestUserMessageAt: string | null }>>([]).pipe(
        Atom.keepAlive,
      ),
    },
  };
});

vi.mock("../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: (environmentId: string) =>
      environmentId === "other" ? mocks.atoms.otherProviders : mocks.atoms.providers,
    providerInstallState: ({ environmentId }: { environmentId: string }) =>
      environmentId === "other" ? mocks.atoms.otherInstall : mocks.atoms.install,
    startProviderInstall: "startProviderInstall",
    refreshProviders: "refreshProviders",
  },
}));
vi.mock("../state/threads", () => ({
  environmentThreadShells: { threadShellsAtom: mocks.atoms.threads },
}));
vi.mock("../state/query", async () => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    useEnvironmentQuery: (query: typeof mocks.atoms.install | null) => ({
      data: useAtomValue(query ?? mocks.atoms.install),
    }),
  };
});
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.startInstall }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { onboardingCompletedAt: string | null }) => unknown) =>
    select({ onboardingCompletedAt: null }),
}));
vi.mock("../hooks/useRecordClientEvent", () => ({ useRecordClientEvent: () => mocks.record }));
vi.mock("../onboarding/firstRun", () => ({ completeOnboarding: () => mocks.complete() }));

import {
  FirstRunAgentStarter,
  useFirstRunAgentSetup,
  useFirstRunAgentStarterEnvironment,
  useFirstRunAgentStatus,
  useStartFirstRunAgent,
} from "./FirstRunAgent";
import {
  FIRST_RUN_AGENT_SLOW_START_MS,
  FIRST_RUN_AGENT_START_TIMEOUT_MS,
  FIRST_SCREEN_IDLE_THRESHOLD_MS,
} from "./upComputerOnboarding.logic";

const testAtoms = mocks.atoms;
const environmentId = EnvironmentId.make("env");
const otherEnvironmentId = EnvironmentId.make("other");

function openCode(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("opencode"),
    driver: ProviderDriverKind.make("opencode"),
    enabled: true,
    installed: true,
    version: "1.19.3",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-25T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

function installState(operationId: string, overrides: Partial<ProviderInstallState>) {
  return {
    driver: ProviderDriverKind.make("opencode"),
    operationId,
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: null,
    version: "1.19.3",
    installedVersion: null,
    canRemove: false,
    message: null,
    ...overrides,
  } as ProviderInstallState;
}

const signedOutClaude = openCode({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  status: "error",
  auth: { status: "unauthenticated" },
});

/** Every status a committed render showed, as the composer's effects would see it. */
let committed: Array<ReturnType<typeof useFirstRunAgentStatus>["status"]>;
let otherCommitted: Array<ReturnType<typeof useFirstRunAgentStatus>["status"]>;
let retry: () => void;
let retrying: boolean;

function Composer() {
  const firstRunAgent = useFirstRunAgentStatus(environmentId, true);
  useAtomValue(testAtoms.providers);
  useEffect(() => {
    committed.push(firstRunAgent.status);
    retry = firstRunAgent.retry;
    retrying = firstRunAgent.retrying;
  });
  return null;
}

/** The composer on another computer, which this window's first run does not set up. */
function OtherComposer() {
  const { status } = useFirstRunAgentStatus(otherEnvironmentId, true);
  useEffect(() => {
    otherCommitted.push(status);
  });
  return null;
}

let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  committed = [];
  otherCommitted = [];
  mocks.events.length = 0;
  registry = AtomRegistry.make();
  registry.set(testAtoms.threads, []);
  // A signed-out agent of the user's keeps the install that starts by itself.
  registry.set(testAtoms.providers, [
    signedOutClaude,
    openCode({ enabled: false, status: "disabled" }),
  ]);
  registry.set(testAtoms.otherProviders, [openCode({ enabled: false, status: "disabled" })]);
  mocks.startInstall.mockResolvedValue({
    _tag: "Success",
    value: { operationId: null, phase: "downloading" },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root.render(
      <RegistryContext.Provider value={registry}>
        <FirstRunAgentStarter environmentId={environmentId} askAgain={false} />
        <Composer />
        <OtherComposer />
      </RegistryContext.Provider>,
    );
  });
}

async function update(change: () => void) {
  await act(async () => change());
}

const preparing = { kind: "preparing", progress: null, slow: false };

it("never offers provider settings between a first run's install succeeding and OpenCode answering", async () => {
  await render();
  expect(mocks.startInstall).toHaveBeenCalled();
  expect(committed.at(-1)).toEqual(preparing);
  committed = [];
  await update(() => registry.set(testAtoms.install, installState("first-run", {})));
  await update(() =>
    registry.set(testAtoms.install, installState("first-run", { phase: "succeeded" })),
  );
  await update(() => registry.set(testAtoms.providers, [openCode({ statusPending: true })]));
  const beforeReady = committed.length;
  await update(() => registry.set(testAtoms.providers, [openCode()]));

  expect(committed.slice(0, beforeReady)).not.toContain(null);
  expect(new Set(committed.slice(beforeReady))).toEqual(new Set([null]));
});

const failedEvents = () =>
  mocks.events.filter(
    (event) => event.event === "onboarding.first_run_agent" && event.outcome === "failed",
  );
const retriedEvents = () =>
  mocks.events.filter(
    (event) => event.event === "onboarding.first_run_agent" && event.outcome === "retried",
  );
const failedOf = (reason: string) => ({
  event: "onboarding.first_run_agent",
  outcome: "failed",
  reason,
});
const autoRetried = { event: "onboarding.first_run_agent", outcome: "retried", automatic: true };

async function startInstalled(operationId: string) {
  await render();
  await update(() =>
    registry.set(testAtoms.install, installState(operationId, { phase: "succeeded" })),
  );
  await update(() => registry.set(testAtoms.providers, [openCode({ statusPending: true })]));
}

it("shows a slow start, retries a timeout once by itself, and reports each failed attempt once", async () => {
  await render();
  await update(() =>
    registry.set(testAtoms.install, installState("slow-start", { phase: "succeeded" })),
  );
  // The server has not turned OpenCode on yet, then checks it for longer than it should.
  expect(committed.at(-1)).toEqual(preparing);
  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_SLOW_START_MS - 1));
  await update(() => registry.set(testAtoms.providers, [openCode({ statusPending: true })]));
  expect(committed.at(-1)).toEqual(preparing);
  await update(() => vi.advanceTimersByTime(1));
  expect(committed.at(-1)).toEqual({ ...preparing, slow: true });
  expect(failedEvents()).toEqual([]);

  const checks = mocks.startInstall.mock.calls.length;
  await update(() =>
    vi.advanceTimersByTime(FIRST_RUN_AGENT_START_TIMEOUT_MS - FIRST_RUN_AGENT_SLOW_START_MS),
  );
  // The app's own second attempt: still starting, never a failed state in between.
  expect(committed.every((status) => status?.kind !== "failed")).toBe(true);
  expect(committed.at(-1)).toEqual({ ...preparing, slow: true });
  expect(mocks.startInstall.mock.calls.length).toBe(checks + 1);
  expect(failedEvents()).toEqual([failedOf("startup_timeout")]);
  expect(retriedEvents()).toEqual([autoRetried]);

  const failing = openCode({
    status: "error",
    statusReason: "migration",
    checkedAt: "2026-10-25T00:01:30.000Z",
  });
  await update(() => registry.set(testAtoms.providers, [failing]));
  expect(committed.at(-1)).toMatchObject({ kind: "failed", reason: "migration" });
  expect(failedEvents()).toEqual([failedOf("startup_timeout"), failedOf("migration")]);

  await update(() => retry());
  expect(committed.at(-1)).toEqual(preparing);
  await update(() =>
    registry.set(testAtoms.providers, [{ ...failing, checkedAt: "2026-10-25T00:01:40.000Z" }]),
  );
  expect(committed.at(-1)).toMatchObject({ kind: "failed", reason: "migration" });
  expect(retriedEvents()).toEqual([
    autoRetried,
    { event: "onboarding.first_run_agent", outcome: "retried" },
  ]);
  expect(failedEvents()).toHaveLength(3);

  await update(() => registry.set(testAtoms.providers, [openCode()]));
  expect(committed.at(-1)).toBeNull();
  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_START_TIMEOUT_MS));
  await update(() => registry.set(testAtoms.providers, [openCode({ enabled: false })]));
  expect(committed.at(-1)).toBeNull();
  expect(failedEvents()).toHaveLength(3);
});

it("retries a failed download once by itself before it offers Retry", async () => {
  await render();
  const installs = mocks.startInstall.mock.calls.length;
  await update(() => registry.set(testAtoms.install, installState("first", { phase: "failed" })));
  expect(mocks.startInstall.mock.calls.length).toBe(installs + 1);
  expect(committed.every((status) => status?.kind !== "failed")).toBe(true);
  expect(failedEvents()).toEqual([failedOf("install")]);
  expect(retriedEvents()).toEqual([autoRetried]);

  await update(() => registry.set(testAtoms.install, installState("second", {})));
  await update(() => registry.set(testAtoms.install, installState("second", { phase: "failed" })));
  expect(committed.at(-1)).toMatchObject({ kind: "failed", reason: "install" });
  expect(mocks.startInstall.mock.calls.length).toBe(installs + 1);
  expect(retriedEvents()).toEqual([autoRetried]);
});

it("offers Retry again at the attempt's timeout when its check never answers", async () => {
  await startInstalled("hung");
  // The first attempt, then the app's own second one.
  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_START_TIMEOUT_MS));
  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_START_TIMEOUT_MS));
  expect(committed.at(-1)).toMatchObject({ kind: "failed", reason: "startup_timeout" });

  mocks.startInstall.mockReturnValueOnce(new Promise(() => {}));
  await update(() => retry());
  expect(retrying).toBe(true);
  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_START_TIMEOUT_MS));
  expect(committed.at(-1)).toMatchObject({ kind: "failed", reason: "startup_timeout" });
  expect(retrying).toBe(false);
});

it("takes OpenCode turned off during its first start as the user's choice", async () => {
  await startInstalled("turned-off");
  await update(() =>
    registry.set(testAtoms.providers, [openCode({ enabled: false, status: "disabled" })]),
  );
  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_START_TIMEOUT_MS));

  expect(committed.at(-1)).toBeNull();
  expect(failedEvents()).toEqual([]);
  expect(retriedEvents()).toEqual([]);
});

it("sets up only its own computer, so another one without an agent offers provider settings", async () => {
  await render();
  expect(committed.at(-1)).toEqual(preparing);
  expect(new Set(otherCommitted)).toEqual(new Set([null]));

  await update(() =>
    registry.set(testAtoms.otherInstall, installState("other-own", { phase: "succeeded" })),
  );
  expect(new Set(otherCommitted)).toEqual(new Set([null]));
});

const idleEvents = () =>
  mocks.events.filter((event) => event.event === "onboarding.first_screen_idle");

it("reports a first screen left without a turn once, after the idle threshold", async () => {
  await render();
  await update(() => registry.set(testAtoms.providers, [openCode()]));
  expect(mocks.events.map((event) => event.event)).toContain("onboarding.completed");

  await update(() => vi.advanceTimersByTime(FIRST_SCREEN_IDLE_THRESHOLD_MS - 1));
  expect(idleEvents()).toEqual([]);
  await update(() => vi.advanceTimersByTime(1));
  expect(idleEvents()).toEqual([
    { event: "onboarding.first_screen_idle", thresholdMs: FIRST_SCREEN_IDLE_THRESHOLD_MS },
  ]);

  await update(() => vi.advanceTimersByTime(FIRST_SCREEN_IDLE_THRESHOLD_MS));
  expect(idleEvents()).toHaveLength(1);
});

it("does not report a first screen where the user requested a turn", async () => {
  await render();
  await update(() => registry.set(testAtoms.providers, [openCode()]));
  await update(() => vi.advanceTimersByTime(60_000));
  await update(() =>
    registry.set(testAtoms.threads, [{ latestUserMessageAt: "2026-10-25T00:01:00.000Z" }]),
  );

  await update(() => vi.advanceTimersByTime(FIRST_SCREEN_IDLE_THRESHOLD_MS));
  expect(idleEvents()).toEqual([]);
});

it("does not report a window that did not onboard a new user", async () => {
  mocks.complete.mockRejectedValueOnce(new Error("settings write failed"));
  await render();
  await update(() => registry.set(testAtoms.providers, [openCode()]));

  await update(() => vi.advanceTimersByTime(FIRST_SCREEN_IDLE_THRESHOLD_MS * 2));
  expect(idleEvents()).toEqual([]);
});

/** The gate's part: it asks for the starter only while its decision is the wizard. */
function Gate({ requested }: { readonly requested: EnvironmentId | null }) {
  const starterEnvironmentId = useFirstRunAgentStarterEnvironment(requested);
  return starterEnvironmentId === null ? null : (
    <FirstRunAgentStarter environmentId={starterEnvironmentId} askAgain={false} />
  );
}

it("finishes setup and reports it after the gate stops asking for the starter", async () => {
  const renderGate = (requested: EnvironmentId | null) =>
    act(async () => {
      root.render(
        <RegistryContext.Provider value={registry}>
          <Gate requested={requested} />
        </RegistryContext.Provider>,
      );
    });
  await renderGate(environmentId);
  expect(mocks.startInstall).toHaveBeenCalled();
  // Home's scratch project, or a project the user adds, ends the wizard decision mid-download.
  await renderGate(null);
  await update(() => registry.set(testAtoms.install, installState("kept", { phase: "succeeded" })));
  await update(() => registry.set(testAtoms.providers, [openCode()]));

  expect(mocks.events).toContainEqual({ event: "onboarding.first_run_agent", outcome: "ready" });
  expect(mocks.events.map((event) => event.event)).toContain("onboarding.completed");
});

let installFromScreen: () => void;

/** The no-agent screen's part: its Install card. */
function ScreenInstall() {
  const [, setSetup] = useFirstRunAgentSetup(environmentId);
  const start = useStartFirstRunAgent(environmentId);
  useEffect(() => {
    installFromScreen = () => {
      setSetup((current) => ({ ...current, start: "install", source: "no_agent_screen" }));
      void start("no_agent_screen");
    };
  });
  return null;
}

it("downloads nothing with no agent installed until the screen's Install, then tags its events", async () => {
  registry.set(testAtoms.providers, [openCode({ enabled: false, status: "disabled" })]);
  mocks.startInstall.mockResolvedValue({
    _tag: "Success",
    value: { operationId: "from-screen", phase: "downloading" },
  });
  await act(async () => {
    root.render(
      <RegistryContext.Provider value={registry}>
        <FirstRunAgentStarter environmentId={environmentId} askAgain={false} />
        <Composer />
        <ScreenInstall />
      </RegistryContext.Provider>,
    );
  });
  await update(() => vi.advanceTimersByTime(60_000));
  expect(mocks.startInstall).not.toHaveBeenCalled();
  expect(new Set(committed)).toEqual(new Set([null]));

  await update(() => installFromScreen());
  expect(mocks.startInstall).toHaveBeenCalledTimes(1);
  await update(() =>
    registry.set(testAtoms.install, installState("from-screen", { phase: "failed" })),
  );
  await update(() => registry.set(testAtoms.providers, [openCode()]));
  const source = { source: "no_agent_screen" };
  expect(mocks.events).toEqual(
    expect.arrayContaining([
      { event: "onboarding.first_run_agent", outcome: "started", ...source },
      { ...failedOf("install"), ...source },
      { ...autoRetried, ...source },
      { event: "onboarding.first_run_agent", outcome: "ready", ...source },
    ]),
  );
});
