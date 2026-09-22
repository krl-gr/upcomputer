import type { ProductManifestSnapshot } from "@upcomputer/contracts";

import type { ExperimentalServerProductComposition } from "./ServerProductComposition.ts";

export interface ExperimentalServerProductEntry<
  Composition extends ExperimentalServerProductComposition = ExperimentalServerProductComposition,
> {
  readonly manifest: ProductManifestSnapshot;
  readonly composition: Composition;
  readonly commandName?: string;
  readonly description?: string;
}

export function defineExperimentalServerProductEntry<
  const Entry extends ExperimentalServerProductEntry,
>(entry: Entry): Entry {
  return entry;
}
