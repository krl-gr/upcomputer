import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ProviderInstallState,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@upcomputer/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const setup = vi.hoisted(() => ({
  auth: null as ProviderAuthState | null,
  installation: null as ProviderInstallState | null,
  authState: vi.fn((_target: unknown) => "auth"),
  installState: vi.fn((_target: unknown) => "installation"),
  startAuth: vi.fn(),
  completeAuth: vi.fn(),
  cancelAuth: vi.fn(),
  logoutAuth: vi.fn(),
  startInstall: vi.fn(),
  cancelInstall: vi.fn(),
  removeInstall: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providerAuthState: setup.authState,
    providerInstallState: setup.installState,
    startProviderAuth: setup.startAuth,
    completeProviderAuth: setup.completeAuth,
    cancelProviderAuth: setup.cancelAuth,
    logoutProviderAuth: setup.logoutAuth,
    startProviderInstall: setup.startInstall,
    cancelProviderInstall: setup.cancelInstall,
    removeProviderInstallation: setup.removeInstall,
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: string) => ({
    data: atom === "auth" ? setup.auth : setup.installation,
    error: null,
    isPending: false,
    refresh: () => {},
  }),
}));

vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: setup.confirm } }),
}));

// Tooltip positioning needs a DOM; the trigger's rendered button is what matters here.
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: React.ReactElement; children: ReactNode }) => ({
    ...render,
    props: { ...(render.props as object), children },
  }),
  TooltipPopup: () => null,
}));

import { ProviderSetupOnboarding, ProviderSetupSection } from "./ProviderSetupSection";

const environmentId = EnvironmentId.make("remote-google");
const instanceId = ProviderInstanceId.make("antigravity_work");
const driver = ProviderDriverKind.make("antigravity");
const instance: ProviderInstanceConfig = { driver, enabled: true };
const provider: ServerProvider = {
  instanceId,
  driver,
  installed: true,
  enabled: true,
  version: "test-version",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-09-02T00:00:00.000Z",
  models: [],
  skills: [],
  slashCommands: [],
  setup: { canAuthenticate: true, canInstall: true },
};

function authState(patch: Partial<ProviderAuthState> = {}): ProviderAuthState {
  return {
    instanceId,
    phase: "waiting",
    flowId: "flow-1",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test-only",
    expiresAt: "2026-09-02T00:05:00.000Z",
    message: null,
    ...patch,
  };
}

let renderer: ReactTestRenderer | undefined;

function renderSetup(
  options: {
    provider?: ServerProvider | undefined;
    config?: Record<string, unknown>;
    environmentId?: EnvironmentId | undefined;
  } = {},
): ReactTestRenderer {
  const element = (
    <ProviderSetupSection
      environmentId={"environmentId" in options ? options.environmentId : environmentId}
      instanceId={instanceId}
      instance={options.config ? { ...instance, config: options.config } : instance}
      liveProvider={"provider" in options ? options.provider : provider}
      refreshProviderStatus={() => {}}
    />
  );
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
  return renderer!;
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

function findButton(view: ReactTestRenderer, label: string): ReactTestInstance | undefined {
  return view.root.findAll(
    (node) =>
      node.type === "button" && (textOf(node) === label || node.props["aria-label"] === label),
  )[0];
}

function hasText(view: ReactTestRenderer, text: string): boolean {
  return (
    view.root.findAll((node) => typeof node.type === "string" && textOf(node) === text).length > 0
  );
}

function countText(view: ReactTestRenderer, text: string): number {
  return view.root.findAll(
    (node) =>
      typeof node.type === "string" && node.children.length === 1 && node.children[0] === text,
  ).length;
}

async function click(view: ReactTestRenderer, label: string) {
  const target = findButton(view, label);
  if (!target) throw new Error(`Missing button: ${label}`);
  if (target.props.disabled) throw new Error(`Button is disabled: ${label}`);
  await act(async () => {
    target.props.onClick();
  });
}

function callbackInput(view: ReactTestRenderer) {
  return view.root.find(
    (node) => node.type === "input" && node.props.id === `provider-callback-${instanceId}`,
  );
}

function typeCallback(view: ReactTestRenderer, value: string) {
  const target = { value };
  act(() => callbackInput(view).props.onChange({ target, currentTarget: target, nativeEvent: {} }));
}

describe("Antigravity setup", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    setup.auth = authState();
    setup.installation = {
      driver,
      operationId: null,
      phase: "idle",
      downloadedBytes: 0,
      totalBytes: null,
      version: null,
      installedVersion: null,
      canRemove: false,
      message: null,
    };
    for (const command of [
      setup.startAuth,
      setup.completeAuth,
      setup.cancelAuth,
      setup.logoutAuth,
      setup.startInstall,
      setup.cancelInstall,
      setup.removeInstall,
    ]) {
      command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
    }
    setup.confirm.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("waits for verified auth after submitting a callback to the selected environment", async () => {
    const callbackUrl = "http://127.0.0.1:5555/?state=test-only&code=test-only";
    let view = renderSetup();
    typeCallback(view, callbackUrl);
    const form = view.root.find((node) => node.type === "form");
    await act(async () => {
      form.props.onSubmit({ preventDefault: () => {} });
    });

    expect(setup.completeAuth).toHaveBeenCalledWith({
      environmentId,
      input: { instanceId, flowId: "flow-1", callbackUrl },
    });
    view = renderSetup();
    expect(hasText(view, "Signed in with Google.")).toBe(false);
    expect(callbackInput(view).props.value).toBe("");

    setup.auth = authState({ phase: "verifying", authorizationUrl: null });
    expect(hasText(renderSetup(), "Signed in with Google.")).toBe(false);

    setup.auth = authState({ phase: "succeeded", authorizationUrl: null });
    view = renderSetup({
      provider: { ...provider, status: "ready", auth: { status: "authenticated" } },
    });
    expect(hasText(view, "Signed in with Google.")).toBe(true);
  });

  it("offers sign-in again when credentials expire after a completed auth flow", () => {
    setup.auth = authState({
      phase: "succeeded",
      authorizationUrl: null,
      message: "Google sign-in complete.",
    });
    renderSetup({ provider: { ...provider, status: "ready", auth: { status: "authenticated" } } });
    const expired = renderSetup();
    expect(findButton(expired, "Sign in with Google")).toBeDefined();
    expect(hasText(expired, "Signed in with Google.")).toBe(false);
    expect(hasText(expired, "Google sign-in complete.")).toBe(false);
  });

  it("does not send a callback left over from a replaced sign-in flow", async () => {
    const view = renderSetup();
    typeCallback(view, "http://127.0.0.1:5555/?state=old-flow&code=test-only");
    setup.auth = authState({ flowId: "flow-2" });
    const next = renderSetup();
    expect(callbackInput(next).props.value).toBe("");
    const form = next.root.find((node) => node.type === "form");
    await act(async () => {
      form.props.onSubmit({ preventDefault: () => {} });
    });

    expect(setup.completeAuth).not.toHaveBeenCalled();
    expect(setup.authState).toHaveBeenLastCalledWith({ environmentId, input: { instanceId } });
  });

  it("coalesces repeated sign-in clicks while start is pending", async () => {
    setup.auth = authState({ phase: "idle", flowId: null, authorizationUrl: null });
    let completeStart: (value: { _tag: "Success"; value: undefined }) => void = () => {
      throw new Error("Missing start resolver.");
    };
    setup.startAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        completeStart = resolve;
      }),
    );
    const view = renderSetup();
    const signIn = findButton(view, "Sign in with Google")!;
    await act(async () => {
      signIn.props.onClick();
      signIn.props.onClick();
    });

    expect(setup.startAuth).toHaveBeenCalledTimes(1);
    expect(setup.startAuth).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
    await act(async () => completeStart({ _tag: "Success", value: undefined }));
  });

  it("shows a repeated runtime status message only once", () => {
    setup.installation = {
      ...setup.installation!,
      operationId: "install-1",
      phase: "verifying",
      message: "Checking the downloaded runtime.",
    };
    expect(countText(renderSetup(), "Checking the downloaded runtime.")).toBe(1);
  });

  it("installs the runtime for the selected environment", async () => {
    setup.auth = authState({ phase: "idle", flowId: null, authorizationUrl: null });
    const view = renderSetup({ provider: { ...provider, installed: false } });
    expect(findButton(view, "Sign in with Google")?.props.disabled).toBe(true);

    await click(view, "Install Antigravity");
    expect(setup.startInstall).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
  });

  it("removes an owned damaged runtime only after confirmation", async () => {
    setup.auth = authState({ phase: "idle", flowId: null, authorizationUrl: null });
    setup.installation = {
      ...setup.installation!,
      phase: "failed",
      canRemove: true,
      installedVersion: null,
    };
    const view = renderSetup();
    await click(view, "Remove downloaded runtime");
    expect(setup.removeInstall).not.toHaveBeenCalled();

    setup.confirm.mockResolvedValue(true);
    await click(view, "Remove downloaded runtime");
    expect(setup.removeInstall).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
  });

  it.each([true, false])(
    "can sign out an unchecked account when its instance is enabled=%s",
    async (enabled) => {
      setup.auth = authState({ phase: "idle", flowId: null, authorizationUrl: null });
      setup.confirm.mockResolvedValue(true);
      const view = renderSetup({
        provider: {
          ...provider,
          enabled,
          installed: false,
          status: enabled ? "warning" : "disabled",
          auth: { status: "unknown" },
        },
      });
      await click(view, "Sign out of Google");
      expect(setup.logoutAuth).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
    },
  );

  it("does not let a shared managed install hide an invalid custom binary path", () => {
    setup.auth = authState({ phase: "idle", flowId: null, authorizationUrl: null });
    setup.installation = {
      ...setup.installation!,
      installedVersion: "test-version",
      canRemove: true,
    };
    const view = renderSetup({
      provider: { ...provider, installed: false },
      config: { binaryPath: "/missing/antigravity" },
    });
    expect(findButton(view, "Sign in with Google")?.props.disabled).toBe(true);
    expect(setup.startAuth).not.toHaveBeenCalled();
  });

  it("uses a credential check for the API key sign-in method", () => {
    setup.auth = authState({ phase: "idle", flowId: null, authorizationUrl: null });
    const view = renderSetup({ config: { authMethod: "gemini-api-key" } });
    expect(hasText(view, "Gemini API key")).toBe(true);
    expect(findButton(view, "Connect")).toBeDefined();
    expect(findButton(view, "Sign in with Google")).toBeUndefined();
  });

  it.each(["older-server", "no-environment"] as const)(
    "does not open private setup subscriptions for an %s view",
    (mode) => {
      const { setup: _setup, ...olderProvider } = provider;
      const view = renderSetup(
        mode === "older-server" ? { provider: olderProvider } : { environmentId: undefined },
      );
      expect(view.toJSON()).toBeNull();
      expect(setup.authState).not.toHaveBeenCalled();
      expect(setup.installState).not.toHaveBeenCalled();
    },
  );

  it("reports onboarding readiness once the provider can run threads", () => {
    const onConnectionStateChange = vi.fn();
    const onOnboardingStepChange = vi.fn();
    const renderOnboarding = (liveProvider: ServerProvider) => {
      const element = (
        <ProviderSetupOnboarding
          environmentId={environmentId}
          instanceId={instanceId}
          instance={instance}
          liveProvider={liveProvider}
          refreshProviderStatus={() => {}}
          onConnectionStateChange={(ready) => onConnectionStateChange(ready)}
          onOnboardingStepChange={onOnboardingStepChange}
        />
      );
      act(() => {
        if (renderer) renderer.update(element);
        else renderer = create(element);
      });
    };

    renderOnboarding(provider);
    expect(onOnboardingStepChange).toHaveBeenCalledWith(
      "Connect Antigravity",
      false,
      expect.any(String),
    );
    expect(onConnectionStateChange).not.toHaveBeenCalled();

    const ready: ServerProvider = {
      ...provider,
      status: "ready",
      auth: { status: "authenticated" },
      models: [
        {
          slug: "antigravity-default",
          name: "Default",
          isCustom: false,
          capabilities: null,
        } as unknown as ServerProvider["models"][number],
      ],
    };
    renderOnboarding(ready);
    renderOnboarding({ ...ready });
    expect(onConnectionStateChange).toHaveBeenCalledTimes(1);
    expect(onConnectionStateChange).toHaveBeenCalledWith(true);
  });
});
