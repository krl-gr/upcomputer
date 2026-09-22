import { describe, expect, it } from "vite-plus/test";
import { WsRpcGroup } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import {
  RpcContributionError,
  createRpcContributionPlan,
  defineNamespacedRpcContribution,
  mergeRpcContributionGroups,
} from "./RpcContribution.ts";

const PingRpc = Rpc.make("upcomputer.tasks.ping", {
  payload: Schema.String,
  success: Schema.String,
});
const PongRpc = Rpc.make("upcomputer.tasks.pong", {
  payload: Schema.String,
  success: Schema.String,
});
const OtherRpc = Rpc.make("upcomputer.other.ping", {
  payload: Schema.String,
  success: Schema.String,
});
const ServerGetConfigRpc = Rpc.make("server.getConfig", {
  success: Schema.String,
});

const PingGroup = RpcGroup.make(PingRpc);
const PongGroup = RpcGroup.make(PongRpc);
const OtherGroup = RpcGroup.make(OtherRpc);
const ServerGroup = RpcGroup.make(ServerGetConfigRpc);

describe("RPC contributions", () => {
  it("defines and orders namespaced RPC contributions", () => {
    const contribution = defineNamespacedRpcContribution({
      id: "tasks-rpc-v1",
      ownerId: "upcomputer.tasks",
      version: 1,
      namespace: "upcomputer.tasks",
      group: PingGroup,
      handlers: () =>
        PingGroup.toLayer(
          PingGroup.of({
            "upcomputer.tasks.ping": (input) => Effect.succeed(input),
          }),
        ),
    });

    expect(createRpcContributionPlan([contribution])).toEqual([contribution]);
  });

  it("rejects methods outside their declared namespace", () => {
    expect(() =>
      defineNamespacedRpcContribution({
        id: "tasks-rpc-v1",
        ownerId: "upcomputer.tasks",
        version: 1,
        namespace: "upcomputer.tasks",
        group: OtherGroup,
        handlers: () => OtherGroup.toLayer(OtherGroup.of({} as never)),
      }),
    ).toThrow(RpcContributionError);
  });

  it("rejects duplicate contributed namespaces", () => {
    const first = defineNamespacedRpcContribution({
      id: "tasks-rpc-v1",
      ownerId: "upcomputer.tasks",
      version: 1,
      namespace: "upcomputer.tasks",
      group: PingGroup,
      handlers: () => PingGroup.toLayer(PingGroup.of({} as never)),
    });
    const second = defineNamespacedRpcContribution({
      id: "tasks-rpc-v2",
      ownerId: "upcomputer.tasks",
      version: 1,
      namespace: "upcomputer.tasks",
      group: PongGroup,
      handlers: () => PongGroup.toLayer(PongGroup.of({} as never)),
    });

    expect(() => createRpcContributionPlan([first, second])).toThrow(RpcContributionError);
  });

  it("rejects methods that shadow core RPC methods", () => {
    const contribution = defineNamespacedRpcContribution({
      id: "server-rpc-v1",
      ownerId: "upcomputer.tasks",
      version: 1,
      namespace: "server",
      group: ServerGroup,
      handlers: () => ServerGroup.toLayer(ServerGroup.of({} as never)),
    });

    expect(() => mergeRpcContributionGroups(WsRpcGroup, [contribution])).toThrow(
      RpcContributionError,
    );
  });
});
