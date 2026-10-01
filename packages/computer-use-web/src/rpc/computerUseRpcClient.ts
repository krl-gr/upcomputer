// @effect-diagnostics anyUnknownInErrorContext:off
import {
  COMPUTER_USE_RPC_METHODS,
  type ComputerUseSettingsInput,
  type ComputerUseStateSnapshot,
} from "@upcomputer/computer-use-contracts/rpc";
import type * as Effect from "effect/Effect";

import type { EnvironmentExtensionRpcRequest } from "../../../../apps/web/src/extensionApi.ts";
import type { ComputerUseWsRpcProtocolClient } from "./computerUseRpcGroup.ts";

type RpcTag = keyof ComputerUseWsRpcProtocolClient & string;
type RpcMethod<Tag extends RpcTag> = ComputerUseWsRpcProtocolClient[Tag];
type RpcInput<Tag extends RpcTag> = Parameters<RpcMethod<Tag>>[0];
type RpcSuccess<Tag extends RpcTag> =
  RpcMethod<Tag> extends (input: any, options?: any) => Effect.Effect<infer Success, any, any>
    ? Success
    : never;
type RpcFailure<Tag extends RpcTag> =
  RpcMethod<Tag> extends (input: any, options?: any) => Effect.Effect<any, infer Failure, any>
    ? Failure
    : never;

export interface ComputerUseWebRpcClient {
  readonly snapshot: () => Promise<ComputerUseStateSnapshot>;
  readonly openBrowser: (url?: string) => Promise<ComputerUseStateSnapshot>;
  readonly closeBrowser: () => Promise<ComputerUseStateSnapshot>;
  readonly clearBrowserProfile: () => Promise<ComputerUseStateSnapshot>;
  readonly updateBrowserSettings: (input: {
    readonly alwaysUseChrome: boolean;
  }) => Promise<ComputerUseStateSnapshot>;
  readonly startComputerUse: () => Promise<ComputerUseStateSnapshot>;
  readonly stopComputerUse: () => Promise<ComputerUseStateSnapshot>;
  readonly doctorComputerUse: () => Promise<ComputerUseStateSnapshot>;
  readonly refreshComputerUseTools: () => Promise<ComputerUseStateSnapshot>;
  readonly updateComputerUseSettings: (
    settings: ComputerUseSettingsInput,
  ) => Promise<ComputerUseStateSnapshot>;
}

export function createComputerUseWebRpcClient(
  requestRpc: EnvironmentExtensionRpcRequest<ComputerUseWsRpcProtocolClient>,
): ComputerUseWebRpcClient {
  const request = <Tag extends RpcTag>(tag: Tag, input: RpcInput<Tag>): Promise<RpcSuccess<Tag>> =>
    requestRpc((client) => {
      const method = client[tag] as unknown as (
        payload: RpcInput<Tag>,
      ) => Effect.Effect<RpcSuccess<Tag>, RpcFailure<Tag>, never>;
      return method(input);
    });

  return {
    snapshot: () => request(COMPUTER_USE_RPC_METHODS.snapshot, {}),
    openBrowser: (url) => request(COMPUTER_USE_RPC_METHODS.openBrowser, url ? { url } : {}),
    closeBrowser: () => request(COMPUTER_USE_RPC_METHODS.closeBrowser, {}),
    clearBrowserProfile: () => request(COMPUTER_USE_RPC_METHODS.clearBrowserProfile, {}),
    updateBrowserSettings: (input) =>
      request(COMPUTER_USE_RPC_METHODS.updateBrowserSettings, input),
    startComputerUse: () => request(COMPUTER_USE_RPC_METHODS.startComputerUse, {}),
    stopComputerUse: () => request(COMPUTER_USE_RPC_METHODS.stopComputerUse, {}),
    doctorComputerUse: () => request(COMPUTER_USE_RPC_METHODS.doctorComputerUse, {}),
    refreshComputerUseTools: () => request(COMPUTER_USE_RPC_METHODS.refreshComputerUseTools, {}),
    updateComputerUseSettings: (settings) =>
      request(COMPUTER_USE_RPC_METHODS.updateComputerUseSettings, { settings }),
  };
}
