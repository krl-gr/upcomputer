import {
  COMPUTER_USE_RPC_METHODS,
  ComputerUseRpcGroup,
  type ComputerUseSettingsInput,
  type ComputerUseStateSnapshot,
} from "@t3tools/computer-use-contracts/rpc";
import type { EnvironmentId } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import {
  requestExperimentalFeatureRpc,
  type ExperimentalFeatureRpcClient,
} from "../../../../apps/web/src/extensionApi.ts";

export interface ComputerUseWebRpcClient {
  readonly snapshot: () => Promise<ComputerUseStateSnapshot>;
  readonly openBrowser: (url?: string) => Promise<ComputerUseStateSnapshot>;
  readonly closeBrowser: () => Promise<ComputerUseStateSnapshot>;
  readonly clearBrowserProfile: () => Promise<ComputerUseStateSnapshot>;
  readonly updateBrowserSettings: (input: {
    readonly alwaysUseChrome: boolean;
  }) => Promise<ComputerUseStateSnapshot>;
  readonly doctorComputerUse: () => Promise<ComputerUseStateSnapshot>;
  readonly updateComputerUseSettings: (
    settings: ComputerUseSettingsInput,
  ) => Promise<ComputerUseStateSnapshot>;
}

/** The browser and computer-use settings methods of one environment's server. */
export function createComputerUseWebRpcClient(
  environmentId: EnvironmentId,
): ComputerUseWebRpcClient {
  const request = <A, E>(
    execute: (
      client: ExperimentalFeatureRpcClient<typeof ComputerUseRpcGroup>,
    ) => Effect.Effect<A, E>,
  ) => requestExperimentalFeatureRpc(environmentId, ComputerUseRpcGroup, execute);
  return {
    snapshot: () => request((client) => client[COMPUTER_USE_RPC_METHODS.snapshot]({})),
    openBrowser: (url) =>
      request((client) => client[COMPUTER_USE_RPC_METHODS.openBrowser](url ? { url } : {})),
    closeBrowser: () => request((client) => client[COMPUTER_USE_RPC_METHODS.closeBrowser]({})),
    clearBrowserProfile: () =>
      request((client) => client[COMPUTER_USE_RPC_METHODS.clearBrowserProfile]({})),
    updateBrowserSettings: (input) =>
      request((client) => client[COMPUTER_USE_RPC_METHODS.updateBrowserSettings](input)),
    doctorComputerUse: () =>
      request((client) => client[COMPUTER_USE_RPC_METHODS.doctorComputerUse]({})),
    updateComputerUseSettings: (settings) =>
      request((client) => client[COMPUTER_USE_RPC_METHODS.updateComputerUseSettings]({ settings })),
  };
}
