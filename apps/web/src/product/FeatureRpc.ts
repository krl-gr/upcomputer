import type { EnvironmentId } from "@t3tools/contracts";
import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { EnvironmentRpcUnavailableError } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as RpcClient from "effect/unstable/rpc/RpcClient";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

/** A feature's view of an environment session client: only its own group's methods. */
export type ExperimentalFeatureRpcClient<Group extends RpcGroup.Any> = RpcClient.RpcClient<
  RpcGroup.Rpcs<Group>
>;

/** Carries a feature's own RPC failure through the environment command. */
class FeatureRpcFailure extends Data.TaggedError("FeatureRpcFailure")<{
  readonly error: unknown;
}> {}

interface FeatureRpcRequest {
  readonly execute: (client: unknown) => Effect.Effect<unknown, FeatureRpcFailure>;
}

// Built on first use: feature modules load while the connection runtime,
// which reads the product entry, may still be initializing.
let featureRpcRequest: ReturnType<typeof makeFeatureRpcRequest> | undefined;

function makeFeatureRpcRequest() {
  return createEnvironmentCommand(connectionAtomRuntime, {
    label: "product-feature-rpc",
    execute: (input: FeatureRpcRequest) =>
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
        const session = yield* SubscriptionRef.get(supervisor.session);
        if (Option.isNone(session)) {
          return yield* new EnvironmentRpcUnavailableError({
            environmentId: supervisor.target.environmentId,
            message: `${supervisor.target.label} is not connected.`,
          });
        }
        return yield* input.execute(session.value.client);
      }),
  });
}

/**
 * Calls a feature's RPC methods on an environment's current session. The
 * session client is built from `WEB_PRODUCT.rpcGroup`, so it carries every
 * group the product's features declare.
 */
export async function requestExperimentalFeatureRpc<Group extends RpcGroup.Any, A, E>(
  environmentId: EnvironmentId,
  _group: Group,
  execute: (client: ExperimentalFeatureRpcClient<Group>) => Effect.Effect<A, E>,
): Promise<A> {
  featureRpcRequest ??= makeFeatureRpcRequest();
  const result = await featureRpcRequest.run(appAtomRegistry, {
    environmentId,
    input: {
      execute: (client) =>
        execute(client as ExperimentalFeatureRpcClient<Group>).pipe(
          Effect.mapError((error) => new FeatureRpcFailure({ error })),
        ),
    },
  });
  if (result._tag === "Success") return result.value as A;
  const failure = squashAtomCommandFailure(result);
  throw failure instanceof FeatureRpcFailure ? failure.error : failure;
}
