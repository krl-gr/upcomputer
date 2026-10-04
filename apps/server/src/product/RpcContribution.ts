import {
  RpcScopeAuthorization,
  type AuthEnvironmentScope,
  type AuthSessionId,
} from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export interface RpcHandlerContext {
  readonly currentSessionId: AuthSessionId;
}

type ErasedRpcGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>;
  readonly middleware: (middleware: typeof RpcScopeAuthorization) => ErasedRpcGroup;
};

/**
 * A feature's RPC group on the core WebSocket transport. Every method lives in
 * the contribution's namespace and declares the session scope it requires, as
 * every core RPC does in `RPC_REQUIRED_SCOPES`.
 */
export interface NamespacedRpcContribution<Rpcs extends Rpc.Any, E = never, R = never> {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly namespace: string;
  readonly group: RpcGroup.RpcGroup<Rpcs>;
  readonly requiredScopes: { readonly [Tag in Rpcs["_tag"]]: AuthEnvironmentScope };
  readonly handlers: (context: RpcHandlerContext) => Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>;
}

export interface AnyNamespacedRpcContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly namespace: string;
  readonly group: ErasedRpcGroup;
  readonly requiredScopes: Readonly<Record<string, AuthEnvironmentScope>>;
  readonly handlers: (context: RpcHandlerContext) => Layer.Layer<never, never, never>;
}

export class RpcContributionError extends Error {
  override readonly name = "RpcContributionError";
  readonly code:
    | "duplicate-method"
    | "duplicate-namespace"
    | "invalid-id"
    | "invalid-version"
    | "method-outside-namespace"
    | "missing-scope";

  constructor(code: RpcContributionError["code"], message: string) {
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

function validateContribution(contribution: AnyNamespacedRpcContribution): void {
  assertStableId(contribution.ownerId, "Owner id");
  assertStableId(contribution.id, "RPC contribution id");
  assertVersion(contribution.version);
  assertStableId(contribution.namespace, "RPC namespace");
  const prefix = `${contribution.namespace}.`;
  for (const method of methodNames(contribution.group)) {
    if (!method.startsWith(prefix) || method.length === prefix.length) {
      throw new RpcContributionError(
        "method-outside-namespace",
        `RPC method '${method}' must belong to namespace '${contribution.namespace}'.`,
      );
    }
    if (!Object.hasOwn(contribution.requiredScopes, method)) {
      throw new RpcContributionError(
        "missing-scope",
        `RPC method '${method}' does not declare its required scope.`,
      );
    }
  }
}

export function defineNamespacedRpcContribution<Rpcs extends Rpc.Any, E, R>(
  contribution: NamespacedRpcContribution<Rpcs, E, R>,
): NamespacedRpcContribution<Rpcs, E, R> & AnyNamespacedRpcContribution {
  const erased = contribution as unknown as AnyNamespacedRpcContribution;
  validateContribution(erased);
  return erased as NamespacedRpcContribution<Rpcs, E, R> & AnyNamespacedRpcContribution;
}

/** Validates contributions against each other and the core methods, in a stable order. */
export function createRpcContributionPlan(
  contributions: ReadonlyArray<AnyNamespacedRpcContribution>,
  coreMethods: Iterable<string> = [],
): ReadonlyArray<AnyNamespacedRpcContribution> {
  const namespaces = new Set<string>();
  const methods = new Set<string>(coreMethods);
  const ordered = [...contributions].sort(
    (left, right) =>
      left.namespace.localeCompare(right.namespace) ||
      left.ownerId.localeCompare(right.ownerId) ||
      left.id.localeCompare(right.id),
  );

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

/**
 * The core group plus every contributed group. Contributed methods get the
 * same scope-authorization middleware core methods carry.
 */
export function mergeRpcContributionGroups<Group extends RpcGroup.Any>(
  coreGroup: Group,
  contributions: ReadonlyArray<AnyNamespacedRpcContribution>,
): Group {
  const core = coreGroup as unknown as ErasedRpcGroup;
  const ordered = createRpcContributionPlan(contributions, core.requests.keys());
  if (ordered.length === 0) return coreGroup;
  return (core as unknown as RpcGroup.RpcGroup<Rpc.Any>).merge(
    ...ordered.map(({ group }) => group.middleware(RpcScopeAuthorization)),
  ) as unknown as Group;
}

export function rpcContributionScopes(
  contributions: ReadonlyArray<AnyNamespacedRpcContribution>,
): ReadonlyMap<string, AuthEnvironmentScope> {
  return new Map(contributions.flatMap(({ requiredScopes }) => Object.entries(requiredScopes)));
}

export function rpcContributionHandlersLayer(
  contributions: ReadonlyArray<AnyNamespacedRpcContribution>,
  context: RpcHandlerContext,
): Layer.Layer<never, never, never> {
  if (contributions.length === 0) return Layer.empty;
  const [first, ...rest] = contributions;
  return Layer.mergeAll(first!.handlers(context), ...rest.map(({ handlers }) => handlers(context)));
}
