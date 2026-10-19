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
  authSection: vi.fn(),
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
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: [{ environmentId: "env", label: "Computer" }] }),
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
vi.mock("../components/settings/ProviderAuthenticationSection", () => ({
  ProviderAuthenticationSection: (props: { instanceId: string }) => {
    mocks.authSection(props);
    return <div data-testid="auth">Sign in to {props.instanceId}</div>;
  },
}));
vi.mock("../components/settings/ProviderSetupSection", () => ({
  ProviderSetupSection: () => <div data-testid="antigravity-setup" />,
  readAntigravityAuthMethod: () => "oauth-personal",
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

const disabled = { enabled: false, status: "disabled", installed: false } as const;
const signedOut = { status: "error", auth: { status: "unauthenticated" } } as const;

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
  // A clean Mac: Codex and Claude on but missing, the other four off.
  mocks.providers = [
    provider("codex", missing),
    provider("claudeAgent", missing),
    ...["cursor", "grok", "opencode", "antigravity"].map((driver) => provider(driver, disabled)),
  ];
  mocks.settings = { providerInstances: {} };
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

function setProvider(driver: string, overrides: Partial<ServerProvider> = {}) {
  mocks.providers = mocks.providers.map((entry) =>
    entry.driver === driver ? provider(driver, overrides) : entry,
  );
  render();
}

function button(label: string, rowName?: string): HTMLButtonElement {
  const scope =
    rowName === undefined
      ? document.body
      : [...document.querySelectorAll("p")].find((element) => element.textContent === rowName)
          ?.parentElement?.parentElement?.parentElement;
  const match = [...(scope?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent?.trim() === label || element.ariaLabel === label,
  );
  if (!match) throw new Error(`No button "${label}"${rowName ? ` in ${rowName}` : ""}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

function lastPatch() {
  return JSON.stringify(mocks.updateSettings.mock.calls.at(-1)?.[0].input.patch);
}

function eventNames() {
  return mocks.events.map((event) =>
    [event.event, event.step, event.action, event.outcome].filter(Boolean).join(":"),
  );
}

it("shows V1's six agents without the usage notice or an import step", () => {
  render();
  const text = document.body.textContent ?? "";
  expect(text).toContain("Set up agents");
  for (const name of ["Codex", "Claude", "Cursor", "Grok", "OpenCode", "Antigravity"]) {
    expect(text).toContain(name);
  }
  expect(text).not.toContain("usage stats");
  expect(text).not.toContain("can be added later");
  expect(button("Continue").disabled).toBe(true);
});

it("opens the app as soon as Codex is connected with ChatGPT", async () => {
  render();
  await click(button("Connect", "Codex"));
  expect(lastPatch()).toContain('"setupMode":"managed"');
  expect(document.body.textContent).toContain("Connect Codex");
  expect(mocks.codexSetup).toHaveBeenLastCalledWith(expect.objectContaining({ autoStart: true }));

  setProvider("codex");
  await act(async () => {});
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Codex is ready" }));
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledOnce();
  expect(eventNames()).toEqual([
    "onboarding.step.viewed:agents",
    "onboarding.agent.action:continue_with_chatgpt",
    "onboarding.step.completed:agents:continued",
    "onboarding.completed",
  ]);
  const flowEvents = mocks.events.filter(
    (event) => "step" in event || event.event === "onboarding.completed",
  );
  expect(flowEvents.every((event) => event.flow === "upcomputer")).toBe(true);
  expect(mocks.events.find((event) => event.outcome === "continued")?.readyProviders).toBe(1);
});

it("installs Claude in the terminal and asks to retry an install that did not finish", async () => {
  render();
  await click(button("Install", "Claude"));
  expect(document.querySelector('[data-testid="terminal"]')?.textContent).toContain(
    "curl -fsSL https://claude.ai/install.sh | bash",
  );
  expect(document.body.textContent).toContain("about 270 MB");
  await click(button("Close terminal"));
  expect(document.body.textContent).toContain("The install did not finish. Run it again.");
  expect(document.body.textContent).not.toContain("reopen");
  expect(eventNames()).toContain("onboarding.agent.terminal_closed:install");
});

it("checks the install again after Close instead of showing Install meanwhile", async () => {
  render();
  await click(button("Install", "Claude"));
  let answer: (value: unknown) => void = () => undefined;
  mocks.refresh.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await click(button("Close terminal"));
  expect(() => button("Install")).toThrow();
  expect(document.body.textContent).toContain("Checking");

  setProvider("claudeAgent", signedOut);
  await act(async () => answer({ _tag: "Success", value: { providers: mocks.providers } }));
  expect(document.body.textContent).toContain("Installed on this computer.");
  expect(button("Sign in").disabled).toBe(false);
});

it("checks OpenCode again from a failed check without asking to sign in", async () => {
  render();
  await click(button("Connect", "OpenCode"));
  setProvider("opencode", { status: "error", auth: { status: "unknown" } });
  expect(document.body.textContent).toContain("Up.computer could not check it.");
  mocks.refresh.mockClear();

  await click(button("Check again"));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-testid="terminal"]')).toBeNull();

  setProvider("opencode");
  await act(async () => {});
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "OpenCode is ready" }));
});

it("opens the app once the stream says OpenCode is ready, before the recheck answers", async () => {
  // LT23: Close to chat took 7.4 s because the first `opencode --version`
  // after install took 4 s on the VM. The app opens with the stream, so the
  // recheck adds nothing on top of the probe.
  render();
  await click(button("Connect", "OpenCode"));
  setProvider("opencode", missing);
  await click(button("Install"));
  mocks.refresh.mockImplementationOnce(() => new Promise(() => undefined));
  await click(button("Close terminal"));
  expect(() => button("Install")).toThrow();

  setProvider("opencode", { checkedAt: "2026-10-17T00:00:07.000Z" });
  await act(async () => {});
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "OpenCode is ready" }));
  expect(onDone).toHaveBeenCalledOnce();
});

it("turns Grok on and installs it from its own screen", async () => {
  render();
  await click(button("Connect", "Grok"));
  expect(lastPatch()).toContain('"enabled":true');
  expect(document.body.textContent).toContain("Set up Grok");
  expect(document.querySelector('[data-testid="terminal"]')).toBeNull();

  setProvider("grok", missing);
  expect(document.body.textContent).not.toContain("Node.js");
  await click(button("Install"));
  expect(document.querySelector('[data-testid="terminal"]')?.textContent).toContain(
    "curl -fsSL https://x.ai/cli/install.sh | bash",
  );
  setProvider("grok", signedOut);
  await click(button("Close terminal"));
  await click(button("Sign in"));
  expect(document.querySelector('[data-testid="terminal"]')?.textContent).toContain("grok login");
});

it("signs in to Cursor in the app after turning it on", async () => {
  render();
  await click(button("Connect", "Cursor"));
  expect(lastPatch()).toContain('"enabled":true');
  setProvider("cursor", { ...signedOut, setup: { canAuthenticate: true, canInstall: false } });
  expect(document.querySelector('[data-testid="auth"]')?.textContent).toBe("Sign in to cursor");
});

it("keeps the way back to ChatGPT after choosing the Codex CLI", async () => {
  mocks.settings = {
    providerInstances: { codex: { driver: "codex", config: { setupMode: "existing" } } },
  };
  render();
  await click(button("Install", "Codex"));
  expect(document.body.textContent).toContain("Use your Codex CLI");
  expect(document.querySelector('[data-testid="terminal"]')?.textContent).toContain(
    "https://chatgpt.com/codex/install.sh",
  );
  await click(button("Sign in with ChatGPT instead, without the CLI"));
  expect(lastPatch()).toContain('"setupMode":"managed"');
});

it("skips the whole setup from the close button", async () => {
  render();
  await click(button("Skip setup"));
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledOnce();
  expect(eventNames()).toEqual([
    "onboarding.step.viewed:agents",
    "onboarding.step.completed:agents:skipped",
    "onboarding.completed",
  ]);
});
