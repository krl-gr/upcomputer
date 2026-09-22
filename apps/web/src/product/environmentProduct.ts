import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProductExtensionLifecycleState,
  ProductExtensionSnapshot,
  ProductManifestSnapshot,
} from "@upcomputer/contracts";
import { supportsProductCapability } from "@upcomputer/shared/product";

import { serverEnvironment, environmentServerConfigsAtom } from "../state/server";
import type {
  ExperimentalWebCapabilityRequirement,
  ExperimentalWebFeatureContribution,
} from "./WebFeature";

export type WebFeatureAvailabilityStatus =
  | "loading"
  | "unavailable"
  | "disabled"
  | "entitlement-required"
  | "readable"
  | "operational"
  | "incompatible"
  | "failed";

export interface WebFeatureAvailability {
  readonly status: WebFeatureAvailabilityStatus;
  readonly canLoad: boolean;
  readonly canMutate: boolean;
  readonly extension: ProductExtensionSnapshot | null;
}

export const SUPPORTED_WEB_EXTENSION_API_VERSION = 1;

const UNAVAILABLE: WebFeatureAvailability = {
  status: "unavailable",
  canLoad: false,
  canMutate: false,
  extension: null,
};

function findUnambiguousExtension(
  manifest: ProductManifestSnapshot,
  extensionId: string,
): ProductExtensionSnapshot | null {
  let match: ProductExtensionSnapshot | null = null;
  for (const extension of manifest.extensions) {
    if (extension.id !== extensionId) continue;
    if (match !== null) return null;
    match = extension;
  }
  return match;
}

function supportsRequirements(
  manifest: ProductManifestSnapshot,
  requirements: ReadonlyArray<ExperimentalWebCapabilityRequirement>,
): boolean {
  return requirements.every(({ id, ...requirement }) =>
    supportsProductCapability(manifest, id, requirement),
  );
}

function availabilityFromState(
  state: ProductExtensionLifecycleState,
  extension: ProductExtensionSnapshot,
): WebFeatureAvailability {
  switch (state) {
    case "enabled-free":
    case "enabled-paid":
      return {
        status: "operational",
        canLoad: true,
        canMutate: true,
        extension,
      };
    case "subscription-expired":
      return {
        status: "readable",
        canLoad: true,
        canMutate: false,
        extension,
      };
    case "installed-disabled":
      return { status: "disabled", canLoad: false, canMutate: false, extension };
    case "entitlement-required":
      return {
        status: "entitlement-required",
        canLoad: true,
        canMutate: false,
        extension,
      };
    case "incompatible":
      return { status: "incompatible", canLoad: false, canMutate: false, extension };
    case "failed-to-load":
      return { status: "failed", canLoad: false, canMutate: false, extension };
    case "unavailable":
      return { ...UNAVAILABLE, extension };
    default:
      // Wire lifecycle identifiers are intentionally open. Unknown states do
      // not imply that executing a locally bundled module is safe.
      return { ...UNAVAILABLE, extension };
  }
}

export function resolveWebFeatureAvailability(input: {
  readonly feature: ExperimentalWebFeatureContribution;
  readonly manifest: ProductManifestSnapshot | null | undefined;
  readonly capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>;
}): WebFeatureAvailability {
  if (input.manifest === undefined) {
    return { status: "loading", canLoad: false, canMutate: false, extension: null };
  }
  if (input.manifest === null) {
    return UNAVAILABLE;
  }
  if (input.manifest.extensionApiVersion !== SUPPORTED_WEB_EXTENSION_API_VERSION) {
    return { status: "incompatible", canLoad: false, canMutate: false, extension: null };
  }

  const extension = findUnambiguousExtension(
    input.manifest,
    input.feature.extensionId ?? input.feature.id,
  );
  if (extension === null || !extension.present) {
    return UNAVAILABLE;
  }
  if (!supportsRequirements(input.manifest, input.capabilities ?? [])) {
    return { status: "incompatible", canLoad: false, canMutate: false, extension };
  }
  if (!extension.capable) {
    return { status: "incompatible", canLoad: false, canMutate: false, extension };
  }

  return availabilityFromState(extension.state, extension);
}

const AVAILABILITY_PRIORITY: Readonly<Record<WebFeatureAvailabilityStatus, number>> = {
  operational: 9,
  readable: 8,
  "entitlement-required": 7,
  loading: 6,
  disabled: 4,
  failed: 3,
  incompatible: 2,
  unavailable: 1,
};

export function resolveConnectedWebFeatureAvailability(input: {
  readonly feature: ExperimentalWebFeatureContribution;
  readonly capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>;
  readonly manifests: ReadonlyArray<ProductManifestSnapshot | null | undefined>;
}): WebFeatureAvailability {
  return (
    input.manifests
      .map((manifest) =>
        resolveWebFeatureAvailability({
          feature: input.feature,
          manifest,
          ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
        }),
      )
      .sort(
        (left, right) => AVAILABILITY_PRIORITY[right.status] - AVAILABILITY_PRIORITY[left.status],
      )[0] ?? UNAVAILABLE
  );
}

export function useConnectedWebFeatureAvailability(
  feature: ExperimentalWebFeatureContribution,
  capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>,
): WebFeatureAvailability {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const manifests =
    configs.size === 0
      ? [undefined]
      : [...configs.values()].map((config) => config.environment.product ?? null);

  return resolveConnectedWebFeatureAvailability({
    feature,
    manifests,
    ...(capabilities === undefined ? {} : { capabilities }),
  });
}

export function useEnvironmentWebFeatureAvailability(
  environmentId: EnvironmentId,
  feature: ExperimentalWebFeatureContribution,
  capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>,
): WebFeatureAvailability {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return resolveWebFeatureAvailability({
    feature,
    manifest: config === null ? undefined : (config.environment.product ?? null),
    ...(capabilities === undefined ? {} : { capabilities }),
  });
}
