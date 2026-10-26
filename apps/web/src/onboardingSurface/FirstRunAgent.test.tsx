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
      threads: Atom.make<ReadonlyArray<{ latestUserMessageAt: string | null }>>([]).pipe(
        Atom.keepAlive,
      ),
    },
  };
});

vi.mock("../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: () => mocks.atoms.providers,
    providerInstallState: () => mocks.atoms.install,
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
    useEnvironmentQuery: () => ({ data: useAtomValue(mocks.atoms.install) }),
  };
});
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.startInstall }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { onboardingCompletedAt: string | null }) => unknown) =>
    select({ onboardingCompletedAt: null }),
}));
vi.mock("../hooks/useRecordClientEvent", () => ({ useRecordClientEvent: () => mocks.record }));
vi.mock("../onboarding/firstRun", () => ({ useCompleteOnboarding: () => mocks.complete }));

import { FirstRunAgentStarter, useFirstRunAgentStatus } from "./FirstRunAgent";
import {
  FIRST_RUN_AGENT_ACTIVATION_WAIT_MS,
  FIRST_SCREEN_IDLE_THRESHOLD_MS,
} from "./upComputerOnboarding.logic";

const testAtoms = mocks.atoms;
const environmentId = EnvironmentId.make("env");

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

/** Every status a committed render showed, as the composer's effects would see it. */
let committed: Array<ReturnType<typeof useFirstRunAgentStatus>["status"]>;

function Composer() {
  const { status } = useFirstRunAgentStatus(environmentId, true);
  useAtomValue(testAtoms.providers);
  useEffect(() => {
    committed.push(status);
  });
  return null;
}

let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  committed = [];
  mocks.events.length = 0;
  registry = AtomRegistry.make();
  registry.set(testAtoms.threads, []);
  registry.set(testAtoms.providers, [openCode({ enabled: false, status: "disabled" })]);
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
        <FirstRunAgentStarter environmentId={environmentId} />
        <Composer />
      </RegistryContext.Provider>,
    );
  });
}

async function update(change: () => void) {
  await act(async () => change());
}

it("never offers provider settings between a first run's install succeeding and OpenCode answering", async () => {
  await render();
  expect(mocks.startInstall).toHaveBeenCalled();
  expect(committed.at(-1)).toEqual({ kind: "preparing", progress: null });
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

it("falls back to provider settings once OpenCode stays off past the activation wait", async () => {
  await render();
  await update(() =>
    registry.set(testAtoms.install, installState("turned-off", { phase: "succeeded" })),
  );
  expect(committed.at(-1)).toEqual({ kind: "preparing", progress: null });

  await update(() => vi.advanceTimersByTime(FIRST_RUN_AGENT_ACTIVATION_WAIT_MS));
  expect(committed.at(-1)).toBeNull();
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
