import { ComputerUseRpcGroup } from "@upcomputer/computer-use-contracts/rpc";
import { makeWsRpcProtocolClientForGroup } from "@upcomputer/client-runtime/ws-rpc-protocol";
import { WsRpcGroup } from "@upcomputer/contracts";
import type * as Effect from "effect/Effect";

/** Core RPC shape plus the browser and computer-use settings namespace. */
export const ComputerUseWsRpcGroup = WsRpcGroup.merge(ComputerUseRpcGroup);

export const makeComputerUseWsRpcProtocolClient =
  makeWsRpcProtocolClientForGroup(ComputerUseWsRpcGroup);

export type ComputerUseWsRpcProtocolClient =
  typeof makeComputerUseWsRpcProtocolClient extends Effect.Effect<infer Client, any, any>
    ? Client
    : never;
