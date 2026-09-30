import { WsRpcGroup } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import { RPC_REQUIRED_SCOPE } from "./ws.ts";

describe("RPC_REQUIRED_SCOPE", () => {
  // A method without a scope entry fails every call with
  // "has no declared authorization scope" at runtime.
  it("declares a scope for every websocket RPC method", () => {
    const missing = [...WsRpcGroup.requests.keys()].filter(
      (method) => !RPC_REQUIRED_SCOPE.has(method),
    );
    expect(missing).toEqual([]);
  });
});
