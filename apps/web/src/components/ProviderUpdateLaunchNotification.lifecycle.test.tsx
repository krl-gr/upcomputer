import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const PRIMARY_ID = "primary";
const VM_ID = "vm";

const state = vi.hoisted(() => {
  let nextToastId = 0;
  return {
    surface: "upcomputer" as "upstream" | "upcomputer",
    environments: [] as unknown[],
    providers: [] as unknown[],
    add: vi.fn((_options: { readonly title?: unknown }) => `toast-${++nextToastId}`),
    close: vi.fn(),
    update: vi.fn(),
    dismissed: new Set<string>(),
    dismiss: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.providers }));
vi.mock("../state/server", () => ({
  primaryServerProvidersAtom: {},
  serverEnvironment: { updateProvider: {} },
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: state.environments }),
  usePrimaryEnvironmentId: () => PRIMARY_ID,
  usePrimaryEnvironment: () => ({ environmentId: PRIMARY_ID }),
  useEnvironmentProviders: () =>
    new Map(
      (state.environments as ReadonlyArray<ReturnType<typeof environment>>).map((entry) => [
        entry.environmentId,
        entry.serverConfig.providers,
      ]),
    ),
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
  useEnvironmentSessionKnown: () => true,
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../providerUpdateDismissal", () => ({
  useDismissedProviderUpdateNotificationKeys: () => ({
    dismissedNotificationKeys: state.dismissed,
    dismissNotificationKey: state.dismiss,
  }),
}));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => state.surface,
}));
vi.mock("./chat/ProviderInstanceIcon", () => ({ ProviderInstanceIcon: () => null }));
vi.mock("./ProviderUpdateEnvironmentRows", () => ({ ProviderUpdateEnvironmentRows: () => null }));
vi.mock("./ui/toast", () => ({
  toastManager: { add: state.add, close: state.close, update: state.update },
  stackedThreadToast: (options: unknown) => options,
  hiddenToastActionProps: {},
}));

function codexWithUpdate(): ServerProvider {
  const checkedAt = "2026-10-18T08:00:00.000Z";
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      updateCommand: "npm install -g @openai/codex",
      canUpdate: true,
      checkedAt,
      message: "Update available.",
    },
  };
}

function environment(input: {
  readonly id: string;
  readonly target: Record<string, unknown>;
  readonly phase: string;
}) {
  return {
    environmentId: input.id,
    label: input.id,
    entry: { target: input.target },
    connection: { phase: input.phase },
    serverConfig: {
      environment: { platform: { os: "darwin" } },
      providers: [codexWithUpdate()],
    },
  };
}

const PRIMARY = environment({
  id: PRIMARY_ID,
  target: { _tag: "PrimaryConnectionTarget" },
  phase: "connected",
});
const MANAGED_VM = environment({
  id: VM_ID,
  target: { _tag: "BearerConnectionTarget", connectionId: "local:vm" },
  phase: "connecting",
});

let renderer: ReactTestRenderer | undefined;

async function render(environments: unknown[]) {
  state.environments = environments;
  // Fresh per test: the startup wait, admitted set and seen keys live for the session.
  const { ProviderUpdateLaunchNotification } = await import("./ProviderUpdateLaunchNotification");
  await act(() => {
    if (renderer) renderer.update(<ProviderUpdateLaunchNotification />);
    else renderer = create(<ProviderUpdateLaunchNotification />);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.surface = "upcomputer";
  state.providers = [codexWithUpdate()];
  state.dismissed = new Set();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("provider update launch prompt lifecycle", () => {
  it("keeps one toast when a local secondary registers and goes away after it showed", async () => {
    // Astra review G3: the routing swapped prompts, closing the toast and
    // opening the other prompt's, then losing it on the way back.
    await render([PRIMARY]);
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add.mock.calls[0]?.[0].title).toBe("Update Available: Codex v2.0.0");

    await render([PRIMARY, MANAGED_VM]);
    await render([PRIMARY, { ...MANAGED_VM, connection: { phase: "connected" } }]);
    await render([PRIMARY]);

    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.close).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("keeps upstream's routing by topology", async () => {
    state.surface = "upstream";
    await render([PRIMARY]);
    expect(state.add).toHaveBeenCalledTimes(1);
    // Upstream mounts the prompt with local secondaries, which waits while one connects.
    await render([PRIMARY, MANAGED_VM]);
    expect(state.close).toHaveBeenCalledWith(state.add.mock.results[0]?.value);
    expect(state.add).toHaveBeenCalledTimes(1);
  });
});
