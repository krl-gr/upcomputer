import type { Discovery } from "@t3tools/client-runtime/relay";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const testState = vi.hoisted(() => ({
  saved: [] as ReadonlyArray<string>,
  discovery: null as unknown as Discovery.RelayEnvironmentDiscoveryState,
  register: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock(import("../connection/catalog"), () => ({
  environmentCatalog: { register: "register" } as never,
}));
vi.mock(import("../state/relay"), () => ({
  relayEnvironmentDiscovery: { refresh: "refresh" } as never,
}));
vi.mock(import("../state/use-atom-command"), () => ({
  useAtomCommand: ((command: string) =>
    command === "register" ? testState.register : testState.refresh) as never,
}));
vi.mock(import("../state/environments"), () => ({
  useEnvironments: (() => ({
    environments: testState.saved.map((environmentId) => ({ environmentId })),
    isReady: true,
  })) as never,
  useRelayEnvironmentDiscovery: () => testState.discovery,
}));
vi.mock(import("../components/ui/toast"), () => ({
  toastManager: { add: testState.toast } as never,
}));

import { AutoAddAccountComputers } from "./AutoAddAccountComputers";

const account = "user_a";
const mac = EnvironmentId.make("env-mac");
const windows = EnvironmentId.make("env-windows");
const linux = EnvironmentId.make("env-linux");

function discovery(
  ids: ReadonlyArray<EnvironmentId> | null,
): Discovery.RelayEnvironmentDiscoveryState {
  return {
    environments: new Map(
      (ids ?? []).map((environmentId) => [
        environmentId,
        {
          environment: { environmentId, label: environmentId },
          availability: "online",
          status: Option.none(),
          error: Option.none(),
        } as never,
      ]),
    ),
    listed: ids !== null,
    refreshing: false,
    offline: false,
    error: Option.none(),
  };
}

function setup() {
  localStorage.removeItem(`upcomputer:connect-known-computers:${account}`);
  testState.saved = [mac];
  testState.discovery = discovery(null);
  testState.register.mockReset().mockResolvedValue(AsyncResult.success({}));
  testState.refresh.mockReset().mockResolvedValue(AsyncResult.success({}));
  testState.toast.mockReset();
}

const autoAdd = () => (
  <AutoAddAccountComputers account={account} fresh={false} primaryEnvironmentId={mac} />
);

describe("AutoAddAccountComputers", () => {
  it("adds nothing the account already listed on the first launch without memory, only later joins", async () => {
    setup();
    await using screen = await render(autoAdd());

    // The user removed the Windows computer before this device remembered removals.
    testState.discovery = discovery([mac, windows]);
    await screen.rerender(autoAdd());
    expect(testState.register).not.toHaveBeenCalled();

    testState.discovery = discovery([mac, windows, linux]);
    await screen.rerender(autoAdd());
    await vi.waitFor(() => expect(testState.register).toHaveBeenCalledOnce());
    expect(testState.register.mock.calls[0]?.[0].target.environmentId).toBe(linux);
  });
});
