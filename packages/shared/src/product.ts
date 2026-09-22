import type {
  ProductCapabilityDescriptor,
  ProductExtensionLifecycleState,
  ProductExtensionSnapshot,
  ProductManifestSnapshot,
} from "@upcomputer/contracts";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const KNOWN_EXTENSION_SOURCES = new Set(["core", "official", "third-party"]);
const KNOWN_EXTENSION_AVAILABILITY = new Set(["free", "free-beta", "paid"]);

export type ExperimentalProductExtensionSource = "core" | "official" | "third-party";
export type ExperimentalProductExtensionAvailability = "free" | "free-beta" | "paid";
export type ExperimentalProductExtensionDiagnosticSeverity = "info" | "warning" | "error";

export interface ExperimentalProductExtensionDiagnostic {
  readonly code: string;
  readonly severity: ExperimentalProductExtensionDiagnosticSeverity;
  readonly message: string;
}

export interface ExperimentalProductCapabilityRegistration {
  readonly id: string;
  readonly version: number;
}

export interface ExperimentalProductExtensionRegistration {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly source: ExperimentalProductExtensionSource;
  readonly availability: ExperimentalProductExtensionAvailability;
  readonly present?: boolean;
  readonly enabled?: boolean;
  readonly capable?: boolean;
  readonly entitlement?: {
    readonly required: boolean;
    readonly granted: boolean;
    readonly expired?: boolean;
  };
  readonly loadError?: string;
  readonly capabilities?: ReadonlyArray<ExperimentalProductCapabilityRegistration>;
  readonly diagnostics?: ReadonlyArray<ExperimentalProductExtensionDiagnostic>;
}

export interface ExperimentalProductManifestInput {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly coreOwnerId?: string;
  readonly coreCapabilities?: ReadonlyArray<ExperimentalProductCapabilityRegistration>;
  readonly extensions?: ReadonlyArray<ExperimentalProductExtensionRegistration>;
}

export interface ProductCapabilityVersionRequirement {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly ownerId?: string;
}

/**
 * Returns one unambiguous advertised capability. Missing metadata and duplicate
 * identifiers both return `undefined` so compatibility checks fail closed.
 */
export function findProductCapability(
  manifest: ProductManifestSnapshot | null | undefined,
  capabilityId: string,
): ProductCapabilityDescriptor | undefined {
  if (!manifest) return undefined;
  let match: ProductCapabilityDescriptor | undefined;
  for (const capability of manifest.capabilities) {
    if (capability.id !== capabilityId) continue;
    if (match) return undefined;
    match = capability;
  }
  return match;
}

/**
 * Checks remote-advertised capability support without assuming that a missing
 * manifest belongs to a core or an official build. Callers can constrain the
 * independently versioned capability range and owner they understand.
 */
export function supportsProductCapability(
  manifest: ProductManifestSnapshot | null | undefined,
  capabilityId: string,
  requirement: ProductCapabilityVersionRequirement = {},
): boolean {
  if (
    (requirement.minimum !== undefined &&
      (!Number.isSafeInteger(requirement.minimum) || requirement.minimum < 1)) ||
    (requirement.maximum !== undefined &&
      (!Number.isSafeInteger(requirement.maximum) || requirement.maximum < 1)) ||
    (requirement.minimum !== undefined &&
      requirement.maximum !== undefined &&
      requirement.minimum > requirement.maximum)
  ) {
    return false;
  }
  const capability = findProductCapability(manifest, capabilityId);
  if (!capability) return false;
  if (requirement.ownerId !== undefined && capability.ownerId !== requirement.ownerId) {
    return false;
  }
  if (requirement.minimum !== undefined && capability.version < requirement.minimum) {
    return false;
  }
  if (requirement.maximum !== undefined && capability.version > requirement.maximum) {
    return false;
  }
  return true;
}

export class ProductManifestInvariantError extends Error {
  override readonly name = "ProductManifestInvariantError";
  readonly code:
    | "invalid-id"
    | "invalid-version"
    | "invalid-source"
    | "invalid-availability"
    | "invalid-diagnostic-severity"
    | "duplicate-extension"
    | "duplicate-capability";

  constructor(
    code:
      | "invalid-id"
      | "invalid-version"
      | "invalid-source"
      | "invalid-availability"
      | "invalid-diagnostic-severity"
      | "duplicate-extension"
      | "duplicate-capability",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function assertStableId(value: string, field: string): void {
  if (!STABLE_ID.test(value)) {
    throw new ProductManifestInvariantError(
      "invalid-id",
      `${field} '${value}' must be a lowercase dot, dash, or underscore separated identifier.`,
    );
  }
}

function assertCapabilityVersion(value: number, id: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProductManifestInvariantError(
      "invalid-version",
      `Capability '${id}' must have a positive integer version.`,
    );
  }
}

function extensionState(
  extension: ExperimentalProductExtensionRegistration,
): ProductExtensionLifecycleState {
  const present = extension.present ?? true;
  const capable = extension.capable ?? true;
  const enabled = extension.enabled ?? false;
  const entitlement = extension.entitlement ?? {
    required: extension.availability === "paid",
    granted: extension.availability !== "paid",
  };

  if (!present) return "unavailable";
  if (extension.loadError !== undefined) return "failed-to-load";
  if (!capable) return "incompatible";
  if (entitlement.required && entitlement.expired) return "subscription-expired";
  if (entitlement.required && !entitlement.granted) return "entitlement-required";
  if (!enabled) return "installed-disabled";
  return extension.availability === "paid" ? "enabled-paid" : "enabled-free";
}

function toExtensionSnapshot(
  extension: ExperimentalProductExtensionRegistration,
): ProductExtensionSnapshot {
  const present = extension.present ?? true;
  const enabled = extension.enabled ?? false;
  const capable = extension.capable ?? true;
  const entitlement = extension.entitlement ?? {
    required: extension.availability === "paid",
    granted: extension.availability !== "paid",
  };
  const diagnostics = [
    ...(extension.diagnostics ?? []),
    ...(extension.loadError !== undefined
      ? [
          {
            code: "extension.load-failed",
            severity: "error" as const,
            message: extension.loadError,
          },
        ]
      : []),
  ];

  return {
    id: extension.id,
    displayName: extension.displayName,
    description: extension.description,
    version: extension.version,
    source: extension.source,
    availability: extension.availability,
    present,
    enabled,
    capable,
    entitled: !entitlement.required || entitlement.granted,
    state: extensionState(extension),
    capabilities: (extension.capabilities ?? []).map(({ id }) => id).sort(),
    diagnostics: [...diagnostics].sort((left, right) => left.code.localeCompare(right.code)),
  };
}

/**
 * Builds a deterministic advertised product snapshot and rejects ambiguous
 * registrations before any extension implementation starts.
 *
 * @experimental The extension API is intentionally unstable during extraction.
 */
export function createExperimentalProductManifest(
  input: ExperimentalProductManifestInput,
): ProductManifestSnapshot {
  assertStableId(input.id, "Product id");
  const coreOwnerId = input.coreOwnerId ?? `${input.id}.core`;
  assertStableId(coreOwnerId, "Core owner id");

  const extensions = [...(input.extensions ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const extensionIds = new Set<string>();
  for (const extension of extensions) {
    assertStableId(extension.id, "Extension id");
    if (!KNOWN_EXTENSION_SOURCES.has(extension.source)) {
      throw new ProductManifestInvariantError(
        "invalid-source",
        `Extension '${extension.id}' has unsupported source '${String(extension.source)}'.`,
      );
    }
    if (!KNOWN_EXTENSION_AVAILABILITY.has(extension.availability)) {
      throw new ProductManifestInvariantError(
        "invalid-availability",
        `Extension '${extension.id}' has unsupported availability '${String(
          extension.availability,
        )}'.`,
      );
    }
    for (const diagnostic of extension.diagnostics ?? []) {
      if (
        diagnostic.severity !== "info" &&
        diagnostic.severity !== "warning" &&
        diagnostic.severity !== "error"
      ) {
        throw new ProductManifestInvariantError(
          "invalid-diagnostic-severity",
          `Extension '${extension.id}' has unsupported diagnostic severity '${String(
            diagnostic.severity,
          )}'.`,
        );
      }
    }
    if (extensionIds.has(extension.id)) {
      throw new ProductManifestInvariantError(
        "duplicate-extension",
        `Extension '${extension.id}' is registered more than once.`,
      );
    }
    extensionIds.add(extension.id);
  }

  const capabilities: ProductCapabilityDescriptor[] = [];
  const capabilityIds = new Set<string>();
  const registerCapabilities = (
    ownerId: string,
    registrations: ReadonlyArray<ExperimentalProductCapabilityRegistration>,
  ) => {
    for (const capability of registrations) {
      assertStableId(capability.id, "Capability id");
      assertCapabilityVersion(capability.version, capability.id);
      if (capabilityIds.has(capability.id)) {
        throw new ProductManifestInvariantError(
          "duplicate-capability",
          `Capability '${capability.id}' is registered more than once.`,
        );
      }
      capabilityIds.add(capability.id);
      capabilities.push({
        id: capability.id,
        version: capability.version,
        ownerId,
      });
    }
  };

  registerCapabilities(coreOwnerId, input.coreCapabilities ?? []);
  for (const extension of extensions) {
    registerCapabilities(extension.id, extension.capabilities ?? []);
  }

  return {
    id: input.id,
    displayName: input.displayName,
    version: input.version,
    extensionApiVersion: 1,
    experimental: true,
    capabilities: capabilities.sort((left, right) => left.id.localeCompare(right.id)),
    extensions: extensions.map(toExtensionSnapshot),
  };
}

export function createUpcomputerProductManifest(
  version: string,
  extensions: ReadonlyArray<ExperimentalProductExtensionRegistration> = [],
): ProductManifestSnapshot {
  return createExperimentalProductManifest({
    id: "upcomputer",
    displayName: "Upcomputer",
    version,
    coreCapabilities: [{ id: "product.manifest", version: 1 }],
    extensions,
  });
}

export function createCoreProductManifest(version: string): ProductManifestSnapshot {
  return createUpcomputerProductManifest(version);
}
