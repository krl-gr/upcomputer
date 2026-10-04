import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type RpcScopeAuthorization,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import { rpcScopeAuthorizationLayer } from "../auth/RpcAuthorization.ts";
import {
  RpcContributionError,
  createRpcContributionPlan,
  defineNamespacedRpcContribution,
  mergeRpcContributionGroups,
  rpcContributionHandlersLayer,
  rpcContributionScopes,
} from "./RpcContribution.ts";

const ReadRpc = Rpc.make("upcomputer.test.read", {
  payload: Schema.String,
  success: Schema.String,
});
const WriteRpc = Rpc.make("upcomputer.test.write", {
  payload: Schema.String,
  success: Schema.String,
});
const TestGroup = RpcGroup.make(ReadRpc, WriteRpc);

const contribution = (written: Array<string>) =>
  defineNamespacedRpcContribution({
    id: "test-rpc",
    ownerId: "upcomputer.test",
    version: 1,
    namespace: "upcomputer.test",
    group: TestGroup,
    requiredScopes: {
      "upcomputer.test.read": AuthOrchestrationReadScope,
      "upcomputer.test.write": AuthOrchestrationOperateScope,
    },
    handlers: ({ currentSessionId }) =>
      TestGroup.toLayer(
        TestGroup.of({
          "upcomputer.test.read": (input) => Effect.succeed(`${currentSessionId}:${input}`),
          "upcomputer.test.write": (input) =>
            Effect.sync(() => {
              written.push(input);
              return input;
            }),
        }),
      ),
  });

describe("RPC contributions", () => {
  it("rejects methods outside the namespace or without a declared scope", () => {
    const valid = contribution([]);
    expect(() => createRpcContributionPlan([{ ...valid, namespace: "upcomputer.other" }])).toThrow(
      RpcContributionError,
    );
    expect(() =>
      createRpcContributionPlan([
        { ...valid, requiredScopes: { "upcomputer.test.read": AuthOrchestrationReadScope } },
      ]),
    ).toThrow(RpcContributionError);
  });

  it("rejects duplicate namespaces and methods that shadow core RPCs", () => {
    const first = contribution([]);
    expect(() => createRpcContributionPlan([first, { ...first, id: "other" }])).toThrow(
      RpcContributionError,
    );
    const ShadowRpc = Rpc.make(WS_METHODS.serverProbe, { success: Schema.String });
    const shadow = { ...first, namespace: "server", group: RpcGroup.make(ShadowRpc) } as never;
    expect(() => mergeRpcContributionGroups(WsRpcGroup, [shadow])).toThrow(RpcContributionError);
  });

  it.effect("serves contributed methods next to core ones, behind their declared scopes", () =>
    Effect.gen(function* () {
      const written: Array<string> = [];
      const contributions = [contribution(written)];
      const core = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (
            tag,
          ): tag is Exclude<
            RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"],
            typeof WS_METHODS.serverProbe
          > => tag !== WS_METHODS.serverProbe,
        ),
      );
      // The typed view of what `mergeRpcContributionGroups` returns at runtime.
      const merged = mergeRpcContributionGroups(
        core,
        contributions,
      ) as unknown as RpcGroup.RpcGroup<
        | RpcGroup.Rpcs<typeof core>
        | Rpc.AddMiddleware<typeof ReadRpc | typeof WriteRpc, typeof RpcScopeAuthorization>
      >;
      const client = yield* RpcTest.makeClient(merged).pipe(
        Effect.provide(
          Layer.mergeAll(
            core.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
            rpcContributionHandlersLayer(contributions, {
              currentSessionId: "session-1" as never,
            }) as Layer.Layer<Rpc.ToHandler<typeof ReadRpc | typeof WriteRpc>>,
            rpcScopeAuthorizationLayer(
              [AuthOrchestrationReadScope],
              rpcContributionScopes(contributions),
            ),
          ),
        ),
      );

      expect(yield* client[WS_METHODS.serverProbe]({})).toEqual({});
      expect(yield* client["upcomputer.test.read"]("hello")).toBe("session-1:hello");
      expect(yield* client["upcomputer.test.write"]("denied").pipe(Effect.flip)).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(written).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
