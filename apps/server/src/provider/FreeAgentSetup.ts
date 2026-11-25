import type { ServerProvider } from "@t3tools/contracts";
import { FREE_AGENT_DRIVER, setFreeAgentSetup } from "@t3tools/provider-core/server/freeAgentSetup";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProviderRegistry } from "./ProviderRegistry.ts";

/** Ready, or turned on and installed while its first check is still out. */
function mayWork(provider: ServerProvider): boolean {
  if (!provider.enabled || !provider.installed) return false;
  if (provider.statusPending === true) return true;
  return provider.status === "ready" && provider.auth.status !== "unauthenticated";
}

/**
 * The free agent is the only working agent while no other provider works or
 * may work. A provider still in its first check counts as working, so a
 * user's own agent never gets setup steps at launch.
 */
export function freeAgentSetupFor(providers: ReadonlyArray<ServerProvider>): {
  readonly active: boolean;
  readonly freeAgentInstanceIds: ReadonlyArray<string>;
} {
  return {
    active: !providers.some(
      (provider) => provider.driver !== FREE_AGENT_DRIVER && mayWork(provider),
    ),
    freeAgentInstanceIds: providers
      .filter((provider) => provider.driver === FREE_AGENT_DRIVER)
      .map((provider) => provider.instanceId),
  };
}

/** Keeps `@t3tools/provider-core/server/freeAgentSetup` in sync with the provider registry. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    const observe = (providers: ReadonlyArray<ServerProvider>) =>
      Effect.sync(() => setFreeAgentSetup(freeAgentSetupFor(providers)));
    yield* registry.getProviders.pipe(
      Effect.flatMap(observe),
      Effect.andThen(Stream.runForEach(registry.streamChanges, observe)),
      Effect.forkScoped,
    );
  }),
);
