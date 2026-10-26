import { act, render, type Screen } from "../../../test/render";
import { RegistryContext } from "@effect/atom-react";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  AuthTerminalOperateScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  type ServerSettings,
  type TerminalCloseInput,
  type TerminalOpenInput,
  type TerminalWriteInput,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
type CommandResult = AsyncResult.AsyncResult<void, Error>;
type Request<Input> = { environmentId: EnvironmentId; input: Input };
type SetupConfig = {
  cwd: string;
  settings: ServerSettings;
  environment: { platform: { os: "darwin" } };
  keybindings: ResolvedKeybindingsConfig;
};
const state = vi.hoisted(() => ({
  sessions: new Map<EnvironmentId, Atom.Writable<SessionResult>>(),
  providers: new Map<EnvironmentId, Atom.Writable<ReadonlyArray<ServerProvider>>>(),
  configs: new Map<EnvironmentId, Atom.Atom<SetupConfig>>(),
  open: vi.fn<(request: Request<TerminalOpenInput>) => Promise<CommandResult>>(),
  write: vi.fn<(request: Request<TerminalWriteInput>) => Promise<CommandResult>>(),
  close: vi.fn<(request: Request<TerminalCloseInput>) => Promise<CommandResult>>(),
  refresh: vi.fn(),
  recordClientEvent: vi.fn(),
  pair: vi.fn(),
  createProject: vi.fn(),
  importThreads: vi.fn(),
  complete: vi.fn<() => Promise<void>>(),
  done: vi.fn(),
}));

// Session grants come from per-test atoms so a test can revoke or regrant mid-flow; the
// real scope checks in ~/state/session read them through the app registry, which the
// wizard is also rendered with.
vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((runtime: never) => ({
      ...actual.createEnvironmentSessionAtoms(runtime),
      sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id)!,
    })) as never,
  };
});
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: [remoteEnvironment] })) as never,
  usePrimaryEnvironment: (() => primaryEnvironment) as never,
}));
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: ((id: EnvironmentId) => state.providers.get(id)!) as never,
      configValueAtom: ((id: EnvironmentId) => state.configs.get(id)!) as never,
      refreshProviders: "refresh" as never,
      recordClientEvent: "recordClientEvent" as never,
    },
  };
});
vi.mock(import("../../state/terminal"), async (original) => ({
  ...(await original()),
  terminalEnvironment: { open: "open", write: "write", close: "close" } as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((
    command:
      | "open"
      | "write"
      | "close"
      | "refresh"
      | "recordClientEvent"
      | "pair"
      | "createProject"
      | "importThreads",
  ) => state[command]) as never,
}));
vi.mock(import("../../connection/onboarding"), async (original) => ({
  ...(await original()),
  connectPairing: "pair" as never,
}));
vi.mock(import("../../state/agentSessions"), async (original) => ({
  ...(await original()),
  agentSessionImport: "importThreads" as never,
}));
vi.mock(import("../../state/projects"), async (original) => ({
  ...(await original()),
  projectEnvironment: { create: "createProject" } as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  readProjects: () => [],
  useProjects: () => [],
}));
vi.mock(import("../../onboarding/useProjectScans"), async (original) => ({
  ...(await original()),
  useProjectScans: () => [],
}));
vi.mock(import("../../onboarding/firstRun"), async (original) => ({
  ...(await original()),
  completeOnboarding: state.complete,
}));
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => false,
}));
vi.mock(import("../settings/ChatGptWelcomeCoordinator"), async (original) => ({
  ...(await original()),
  ChatGptWelcomeCoordinator: () => <></>,
}));
// The real viewport mounts a Ghostty terminal against the PTY; these tests only need to
// see whether the wizard shows it.
vi.mock(import("../ThreadTerminalDrawer"), async (original) => ({
  ...(await original()),
  TerminalViewport: () => <div data-terminal-viewport />,
}));

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { WelcomeWizard } from "./WelcomeWizard";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("paired-remote");
const primaryEnvironment = {
  environmentId: primaryId,
  label: "This computer",
  connection: { phase: "connected" },
  entry: {
    enabled: true,
    target: new PrimaryConnectionTarget({
      environmentId: primaryId,
      label: "This computer",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
    }),
  },
} as const;
const remoteEnvironment = {
  environmentId: remoteId,
  label: "Paired computer",
  connection: { phase: "connected" },
  entry: {
    enabled: true,
    target: new BearerConnectionTarget({
      environmentId: remoteId,
      label: "Paired computer",
      connectionId: "paired-remote",
    }),
  },
} as const;
const missingClaude: ServerProvider = {
  instanceId: ProviderInstanceId.make("claude-work"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: false,
  version: null,
  status: "error",
  auth: { status: "unknown" },
  checkedAt: "2026-09-05T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const signedOutCodex: ServerProvider = {
  ...missingClaude,
  instanceId: ProviderInstanceId.make("codex-work"),
  driver: ProviderDriverKind.make("codex"),
  installed: true,
  auth: { status: "unauthenticated" },
};
const session = (scopes: readonly AuthEnvironmentScope[]): AuthSessionState => ({
  authenticated: true,
  scopes,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "t3_session",
  },
});
function setAccess(environmentId: EnvironmentId, allowed: boolean) {
  appAtomRegistry.set(
    state.sessions.get(environmentId)!,
    AsyncResult.success(session(allowed ? [AuthTerminalOperateScope] : [])),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function pageText() {
  return document.body.textContent ?? "";
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label || element.ariaLabel === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  const node = button(label);
  expect(node.disabled).toBe(false);
  await act(async () => node.click());
}
function hasViewport() {
  return document.querySelector("[data-terminal-viewport]") !== null;
}
async function enterRemoteAgents(screen: Screen) {
  await screen.rerender(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomeWizard localAvailable onDone={state.done} />
    </RegistryContext.Provider>,
  );
  await click("Continue");
  expect(pageText()).toContain("Paired computer");
}

function setup() {
  state.sessions.clear();
  state.providers.clear();
  state.configs.clear();
  for (const id of [primaryId, remoteId]) {
    state.sessions.set(
      id,
      Atom.make<SessionResult>(AsyncResult.success(session([AuthTerminalOperateScope]))).pipe(
        Atom.keepAlive,
      ),
    );
    state.providers.set(
      id,
      Atom.make<ReadonlyArray<ServerProvider>>([missingClaude, signedOutCodex]).pipe(
        Atom.keepAlive,
      ),
    );
    state.configs.set(
      id,
      Atom.make<SetupConfig>({
        cwd: `/fixtures/${id}`,
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [signedOutCodex.instanceId]: {
              driver: signedOutCodex.driver,
              config: { binaryPath: "/opt/codex-work", setupMode: "existing" },
            },
          },
        },
        environment: { platform: { os: "darwin" } },
        keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      }),
    );
  }
  state.open.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.write.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.close.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.refresh.mockReset().mockResolvedValue(AsyncResult.success({ providers: [] }));
  state.recordClientEvent.mockReset().mockResolvedValue(AsyncResult.success({}));
  state.pair.mockReset().mockResolvedValue(AsyncResult.success(remoteId));
  state.complete.mockReset().mockResolvedValue(undefined);
  state.done.mockReset();
}

describe("welcome agent terminal setup", () => {
  it("reports a user who installs Claude but leaves setup with no agent ready", async () => {
    setup();
    state.refresh.mockResolvedValue(
      AsyncResult.success({ providers: [missingClaude, signedOutCodex] }),
    );
    await using screen = await render(null);
    await enterRemoteAgents(screen);
    await click("Install");
    await click("Close");
    await click("Continue");
    await click("Do not import projects");

    expect(state.recordClientEvent.mock.calls.map(([call]) => call)).toEqual([
      { environmentId: primaryId, input: { event: "onboarding.step.viewed", step: "connection" } },
      {
        environmentId: primaryId,
        input: { event: "onboarding.step.completed", step: "connection", outcome: "continued" },
      },
      { environmentId: primaryId, input: { event: "onboarding.step.viewed", step: "agents" } },
      {
        environmentId: remoteId,
        input: { event: "onboarding.agent.action", provider: "claudeAgent", action: "install" },
      },
      {
        environmentId: remoteId,
        input: {
          event: "onboarding.agent.terminal_closed",
          provider: "claudeAgent",
          action: "install",
          installed: false,
          authStatus: missingClaude.auth.status,
        },
      },
      {
        environmentId: primaryId,
        input: {
          event: "onboarding.step.completed",
          step: "agents",
          outcome: "continued",
          readyProviders: 0,
        },
      },
      { environmentId: primaryId, input: { event: "onboarding.step.viewed", step: "import" } },
      {
        environmentId: primaryId,
        input: { event: "onboarding.step.completed", step: "import", outcome: "skipped" },
      },
      {
        environmentId: primaryId,
        input: { event: "onboarding.completed", importedProject: false, importedThreads: 0 },
      },
    ]);
  });
});
