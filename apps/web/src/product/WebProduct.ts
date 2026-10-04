import { RpcScopeAuthorization, WsRpcGroup } from "@t3tools/contracts";
import { makeWsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  defineExperimentalWebFeature,
  WebFeatureInvariantError,
  type ExperimentalWebFeatureContribution,
  type ExperimentalWebNavigationContribution,
  type ExperimentalWebRouteContribution,
  type ExperimentalWebSettingsPageContribution,
} from "./WebFeature";

type ErasedRpcGroup = RpcGroup.RpcGroup<Rpc.Any>;

export interface ExperimentalWebProductComposition {
  readonly features: ReadonlyArray<ExperimentalWebFeatureContribution>;
  readonly navigation: ReadonlyArray<ExperimentalWebNavigationContribution>;
  readonly routes: ReadonlyArray<ExperimentalWebRouteContribution>;
  readonly settings: ReadonlyArray<ExperimentalWebSettingsPageContribution>;
  /** The core group merged with every feature group, as the server serves them. */
  readonly rpcGroup: typeof WsRpcGroup;
  /** The session client factory; core's own when no feature adds RPC groups. */
  readonly makeRpcClient: typeof makeWsRpcProtocolClient;
}

const byOrder = <T extends { readonly id: string; readonly order?: number }>(left: T, right: T) =>
  (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);

function uniqueBy<T>(
  items: ReadonlyArray<T>,
  key: (item: T) => string,
  code: WebFeatureInvariantError["code"],
  describe: (key: string) => string,
): ReadonlyArray<T> {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new WebFeatureInvariantError(code, describe(value));
    seen.add(value);
  }
  return items;
}

/**
 * Feature groups get the same scope middleware the server merges them with,
 * so the client decodes an authorization failure instead of a defect.
 */
function mergeRpcGroups(features: ReadonlyArray<ExperimentalWebFeatureContribution>) {
  const groups = features.flatMap((feature) => feature.rpcGroups ?? []) as ErasedRpcGroup[];
  const methods = new Set<string>(WsRpcGroup.requests.keys());
  for (const group of groups) {
    for (const method of group.requests.keys()) {
      if (methods.has(method)) {
        throw new WebFeatureInvariantError(
          "duplicate-rpc-method",
          `RPC method '${method}' is registered more than once.`,
        );
      }
      methods.add(method);
    }
  }
  if (groups.length === 0) return WsRpcGroup;
  return (WsRpcGroup as unknown as ErasedRpcGroup).merge(
    ...groups.map((group) => group.middleware(RpcScopeAuthorization)),
  ) as unknown as typeof WsRpcGroup;
}

export function composeExperimentalWebFeatures(
  input: ReadonlyArray<ExperimentalWebFeatureContribution>,
): ExperimentalWebProductComposition {
  const features = uniqueBy(
    [...input].map(defineExperimentalWebFeature).sort((a, b) => a.id.localeCompare(b.id)),
    (feature) => feature.id,
    "duplicate-feature",
    (id) => `Web feature '${id}' is registered more than once.`,
  );
  const routes = uniqueBy(
    features.flatMap((feature) => feature.routes ?? []),
    (route) => route.path,
    "duplicate-route",
    (path) => `Web route '${path}' is registered more than once.`,
  );
  const navigation = uniqueBy(
    features.flatMap((feature) => feature.navigation ?? []),
    (item) => item.id,
    "duplicate-navigation",
    (id) => `Web navigation item '${id}' is registered more than once.`,
  );
  const settings = uniqueBy(
    features.flatMap((feature) => feature.settings ?? []),
    (page) => page.path,
    "duplicate-settings",
    (path) => `Web settings page '${path}' is registered more than once.`,
  );
  const rpcGroup = mergeRpcGroups(features);
  return Object.freeze({
    features,
    navigation: [...navigation].sort(byOrder),
    routes,
    settings: [...settings].sort(byOrder),
    rpcGroup,
    makeRpcClient: rpcGroup === WsRpcGroup ? makeWsRpcProtocolClient : RpcClient.make(rpcGroup),
  });
}

export function findExperimentalWebRoute(
  composition: ExperimentalWebProductComposition,
  pathname: string,
): ExperimentalWebRouteContribution | undefined {
  return composition.routes.find((route) => route.path === pathname);
}

export function findExperimentalWebSettingsPage(
  composition: ExperimentalWebProductComposition,
  pathname: string,
): ExperimentalWebSettingsPageContribution | undefined {
  return composition.settings.find((page) => page.path === pathname);
}

export function isExperimentalWebNavigationActive(
  item: ExperimentalWebNavigationContribution,
  pathname: string,
): boolean {
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}
