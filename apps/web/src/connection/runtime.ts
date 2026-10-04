import { Connection } from "@upcomputer/client-runtime/connection";
import { shellSnapshotLoaderLayer } from "@upcomputer/client-runtime/state/shell";
import { threadSnapshotLoaderLayer } from "@upcomputer/client-runtime/state/threads";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { runtimeContextLayer } from "../lib/runtime";
import { getInstalledWebProductComposition } from "../product/WebComposition";
import { connectionPlatformLayer } from "./platform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const snapshotLoaderLayer = Layer.merge(threadSnapshotLoaderLayer, shellSnapshotLoaderLayer);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer;

// Snapshot loaders read the connection's shared authorization service, so they
// sit on top of the connection layer instead of beside it.
const connectionLayer = snapshotLoaderLayer.pipe(
  Layer.provideMerge(
    Connection.layerWithOptions({
      resolveClientFactory: () => getInstalledWebProductComposition().rpc?.clientFactory,
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(runtimeContextLayer, providedConnectionPlatformLayer)),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(connectionLayer);
