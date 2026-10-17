// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ScopedProjectRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  providers: [] as ServerProvider[],
  settings: { providerInstances: {} as Record<string, unknown> },
  candidates: [] as unknown[],
  events: [] as Array<Record<string, unknown>>,
  updateSettings: vi.fn(),
  refresh: vi.fn(),
  complete: vi.fn(),
  toast: vi.fn(),
  codexSetup: vi.fn(),
}));

// Atoms are tokens read at render, as a subscription would, so a new value re-renders.
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    atom === "providers"
      ? mocks.providers
      : {
          cwd: "/home",
          keybindings: [],
          settings: mocks.settings,
          environment: { platform: { os: "darwin" } },
        },
}));
vi.mock("../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: () => "providers",
    configValueAtom: () => "config",
    refreshProviders: "refresh",
    updateSettings: "updateSettings",
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "updateSettings" ? mocks.updateSettings : mocks.refresh,
}));
vi.mock("../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../hooks/useRecordClientEvent", () => ({
  useRecordClientEvent: () => (_environmentId: string, input: Record<string, unknown>) =>
    mocks.events.push(input),
}));
vi.mock("../onboarding/firstRun", () => ({ useCompleteOnboarding: () => mocks.complete }));
vi.mock("../onboarding/useProjectScans", () => ({
  useProjectScans: () => [
    {
      environmentId: "env",
      isPending: false,
      error: null,
      refresh: vi.fn(),
      data: { truncated: false, candidates: mocks.candidates },
    },
  ],
}));
vi.mock("../components/onboarding/WelcomeWizard", () => ({
  AgentInstallTerminal: ({
    session,
    onClose,
  }: {
    session: { command: string };
    onClose: () => void;
  }) => (
    <div data-testid="terminal">
      {session.command}
      <button type="button" onClick={onClose}>
        Close terminal
      </button>
    </div>
  ),
  ImportStep: ({ onDone }: { onDone: () => void }) => (
    <div data-testid="import">
      <h1>Import your projects</h1>
      <button type="button" onClick={() => onDone()}>
        Do not import projects
      </button>
    </div>
  ),
}));
vi.mock("../components/settings/CodexSetupSection", () => ({
  CodexSetupSection: (props: { autoStart: boolean; onModeChange: (mode: string) => void }) => {
    mocks.codexSetup(props);
    return (
      <button type="button" onClick={() => props.onModeChange("existing")}>
        Use existing CLI
      </button>
    );
  },
}));
vi.mock("../components/settings/ChatGptWelcomeCoordinator", () => ({
  ChatGptWelcomeCoordinator: () => null,
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));

import { UpComputerOnboarding } from "./UpComputerOnboarding";

const environmentId = EnvironmentId.make("env");
let root: Root;
let container: HTMLDivElement;
let onDone: ReturnType<typeof vi.fn<(projectRef?: ScopedProjectRef) => void>>;

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.providers = [provider("codex", missing), provider("claudeAgent", missing)];
  mocks.settings = { providerInstances: {} };
  mocks.candidates = [];
  mocks.events = [];
  mocks.complete.mockResolvedValue(undefined);
  mocks.refresh.mockImplementation(async () => ({
    _tag: "Success",
    value: { providers: mocks.providers },
  }));
  onDone = vi.fn<(projectRef?: ScopedProjectRef) => void>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function render() {
  act(() => {
    root.render(
      <UpComputerOnboarding
        environmentId={environmentId}
        resumeCodexSetup={false}
        onDone={onDone}
      />,
    );
  });
}

function button(label: string, index = 0): HTMLButtonElement {
  const matches = [...document.querySelectorAll("button")].filter(
    (element) => element.textContent?.trim() === label || element.ariaLabel === label,
  );
  const match = matches[index];
  if (!match) throw new Error(`No button "${label}"`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

function eventNames() {
  return mocks.events.map((event) =>
    [event.event, event.step, event.action, event.outcome].filter(Boolean).join(":"),
  );
}

it("connects Codex with ChatGPT in one click, then offers import and finishes", async () => {
  mocks.candidates = [{ path: "/project" }];
  render();
  expect(document.body.textContent).toContain("Set up an agent");
  expect(button("Continue").disabled).toBe(true);

  await click(button("Connect"));
  const patch = mocks.updateSettings.mock.calls[0]?.[0].input.patch;
  expect(JSON.stringify(patch)).toContain('"setupMode":"managed"');
  expect(document.body.textContent).toContain("Connect Codex");
  expect(mocks.codexSetup).toHaveBeenLastCalledWith(expect.objectContaining({ autoStart: true }));

  mocks.providers = [provider("codex"), provider("claudeAgent", missing)];
  render();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Codex is ready" }));
  expect(document.querySelector('[data-testid="import"]')).not.toBeNull();

  await click(button("Do not import projects"));
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledWith(undefined);
  expect(eventNames()).toEqual([
    "onboarding.step.viewed:agents",
    "onboarding.agent.action:continue_with_chatgpt",
    "onboarding.step.completed:agents:continued",
    "onboarding.step.viewed:import",
    "onboarding.step.completed:import:skipped",
    "onboarding.completed",
  ]);
  expect(mocks.events.every((event) => event.flow === "upcomputer" || !("step" in event))).toBe(
    true,
  );
  expect(mocks.events.find((event) => event.outcome === "continued")?.readyProviders).toBe(1);
});

it("finishes right after the first working agent when there is nothing to import", async () => {
  render();
  await click(button("Install"));
  expect(document.querySelector('[data-testid="terminal"]')?.textContent).toContain(
    "curl -fsSL https://claude.ai/install.sh | bash",
  );

  mocks.providers = [provider("codex", missing), provider("claudeAgent")];
  render();
  await act(async () => {});
  expect(document.querySelector('[data-testid="import"]')).toBeNull();
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(eventNames()).toEqual([
    "onboarding.step.viewed:agents",
    "onboarding.agent.action:install",
    "onboarding.step.completed:agents:continued",
    "onboarding.completed",
  ]);
});

it("explains a CLI that installed but is not found yet", async () => {
  render();
  await click(button("Install"));
  await click(button("Close terminal"));
  expect(document.body.textContent).toContain(
    "If the install finished, quit and reopen Up.computer so it can find Claude Code.",
  );
  expect(eventNames()).toContain("onboarding.agent.terminal_closed:install");
});

it("keeps the way back to ChatGPT after choosing the Codex CLI", async () => {
  mocks.settings = {
    providerInstances: { codex: { driver: "codex", config: { setupMode: "existing" } } },
  };
  render();
  expect(document.body.textContent).toContain("Codex CLI is not installed yet.");
  await click(button("Install"));
  expect(document.body.textContent).toContain("Use your Codex CLI");
  expect(document.querySelector('[data-testid="terminal"]')?.textContent).toContain(
    "https://chatgpt.com/codex/install.sh",
  );

  await click(button("Sign in with ChatGPT instead, without the CLI"));
  const patch = mocks.updateSettings.mock.calls.at(-1)?.[0].input.patch;
  expect(JSON.stringify(patch)).toContain('"setupMode":"managed"');
});

it("skips the whole setup from the close button", async () => {
  render();
  await click(button("Skip setup"));
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledWith(undefined);
  expect(eventNames()).toEqual([
    "onboarding.step.viewed:agents",
    "onboarding.step.completed:agents:skipped",
    "onboarding.completed",
  ]);
});
