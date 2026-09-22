import type { AuthSessionId } from "@upcomputer/contracts";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export interface RpcHandlerContext {
  readonly currentSessionId: AuthSessionId;
}

export type ServerTransportRpc = Rpc.Any;

type ErasedRpcGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>;
};

export interface NamespacedRpcContribution<Rpcs extends ServerTransportRpc, E = never, R = never> {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly namespace: string;
  readonly group: RpcGroup.RpcGroup<Rpcs>;
  readonly handlers: (context: RpcHandlerContext) => Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>;
}

export interface AnyNamespacedRpcContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly namespace: string;
  readonly group: ErasedRpcGroup;
  readonly handlers: (context: RpcHandlerContext) => Layer.Layer<never, Error, never>;
}

export class RpcContributionError extends Error {
  override readonly name = "RpcContributionError";
  readonly code:
    | "duplicate-method"
    | "duplicate-namespace"
    | "invalid-id"
    | "invalid-version"
    | "method-outside-namespace";

  constructor(
    code:
      | "duplicate-method"
      | "duplicate-namespace"
      | "invalid-id"
      | "invalid-version"
      | "method-outside-namespace",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RpcContributionError(
      "invalid-version",
      `RPC contribution version '${String(version)}' must be a positive safe integer.`,
    );
  }
}

function assertStableId(value: string, label: string): void {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new RpcContributionError(
      "invalid-id",
      `${label} '${value}' must be a stable lowercase identifier.`,
    );
  }
}

function methodNames(group: ErasedRpcGroup): ReadonlyArray<string> {
  return [...group.requests.keys()];
}

function assertMethodsBelongToNamespace(namespace: string, group: ErasedRpcGroup): void {
  const prefix = `${namespace}.`;
  for (const method of methodNames(group)) {
    if (!method.startsWith(prefix) || method.length === prefix.length) {
      throw new RpcContributionError(
        "method-outside-namespace",
        `RPC method '${method}' must belong to namespace '${namespace}'.`,
      );
    }
  }
}

function validateContribution(contribution: AnyNamespacedRpcContribution): void {
  assertStableId(contribution.ownerId, "Owner id");
  assertStableId(contribution.id, "RPC contribution id");
  assertVersion(contribution.version);
  assertStableId(contribution.namespace, "RPC namespace");
  assertMethodsBelongToNamespace(contribution.namespace, contribution.group);
}

export function defineNamespacedRpcContribution<Rpcs extends ServerTransportRpc, E, R>(
  contribution: NamespacedRpcContribution<Rpcs, E, R>,
): NamespacedRpcContribution<Rpcs, E, R> & AnyNamespacedRpcContribution {
  validateContribution(contribution as unknown as AnyNamespacedRpcContribution);
  return contribution as NamespacedRpcContribution<Rpcs, E, R> & AnyNamespacedRpcContribution;
}

export function createRpcContributionPlan<
  const Contributions extends ReadonlyArray<AnyNamespacedRpcContribution>,
>(contributions: Contributions): ReadonlyArray<Contributions[number]> {
  const namespaces = new Set<string>();
  const methods = new Set<string>();
  const ordered = [...contributions].sort((left, right) => {
    const namespaceOrder = left.namespace.localeCompare(right.namespace);
    if (namespaceOrder !== 0) return namespaceOrder;
    const ownerOrder = left.ownerId.localeCompare(right.ownerId);
    return ownerOrder !== 0 ? ownerOrder : left.id.localeCompare(right.id);
  });

  for (const contribution of ordered) {
    validateContribution(contribution);
    if (namespaces.has(contribution.namespace)) {
      throw new RpcContributionError(
        "duplicate-namespace",
        `RPC namespace '${contribution.namespace}' is registered more than once.`,
      );
    }
    namespaces.add(contribution.namespace);

    for (const method of methodNames(contribution.group)) {
      if (methods.has(method)) {
        throw new RpcContributionError(
          "duplicate-method",
          `RPC method '${method}' is registered more than once.`,
        );
      }
      methods.add(method);
    }
  }

  return ordered;
}

export type RpcsOfContribution<Contribution> =
  Contribution extends NamespacedRpcContribution<infer Rpcs, any, any> ? Rpcs : never;

export function mergeRpcContributionGroups<
  CoreRpcs extends Rpc.Any,
  const Contributions extends ReadonlyArray<AnyNamespacedRpcContribution>,
>(
  coreGroup: RpcGroup.RpcGroup<CoreRpcs>,
  contributions: Contributions,
): RpcGroup.RpcGroup<CoreRpcs | RpcsOfContribution<Contributions[number]>> {
  const methods = new Set<string>(coreGroup.requests.keys());
  let merged = coreGroup as unknown as RpcGroup.RpcGroup<Rpc.Any>;

  for (const contribution of createRpcContributionPlan(contributions)) {
    for (const method of methodNames(contribution.group)) {
      if (methods.has(method)) {
        throw new RpcContributionError(
          "duplicate-method",
          `RPC method '${method}' is registered more than once.`,
        );
      }
      methods.add(method);
    }
    merged = merged.merge(contribution.group);
  }

  return merged as unknown as RpcGroup.RpcGroup<
    CoreRpcs | RpcsOfContribution<Contributions[number]>
  >;
}

export function rpcContributionHandlersLayer<
  const Contributions extends ReadonlyArray<AnyNamespacedRpcContribution>,
>(
  contributions: Contributions,
  context: RpcHandlerContext,
): Layer.Layer<Rpc.ToHandler<RpcsOfContribution<Contributions[number]>>, Error, never> {
  const ordered = createRpcContributionPlan(contributions);
  if (ordered.length === 0) {
    return Layer.empty as unknown as Layer.Layer<
      Rpc.ToHandler<RpcsOfContribution<Contributions[number]>>,
      Error,
      never
    >;
  }

  const [first, ...rest] = ordered;
  return Layer.mergeAll(
    first!.handlers(context),
    ...rest.map(({ handlers }) => handlers(context)),
  ) as Layer.Layer<Rpc.ToHandler<RpcsOfContribution<Contributions[number]>>, Error, never>;
}
