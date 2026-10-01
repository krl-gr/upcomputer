import {
  TASK_AGENTS_RPC_CAPABILITY_ID,
  TASK_AGENTS_RPC_CONTRACT_VERSION,
  TASK_AUTOMATIONS_RPC_CAPABILITY_ID,
  TASK_AUTOMATIONS_RPC_CONTRACT_VERSION,
  TASKS_RPC_CAPABILITY_ID,
  TASKS_RPC_CONTRACT_VERSION,
} from "@upcomputer/tasks-contracts/v1";
import type { ProductExtensionSnapshot, ProductManifestSnapshot } from "@upcomputer/contracts";
import { supportsProductCapability } from "@upcomputer/shared/product";

const TASKS_EXTENSION_ID = "upcomputer.tasks" as const;
const TASKS_WEB_SUPPORTED_EXTENSION_API_VERSION = 1 as const;

export type TasksWebAvailability =
  | "loading"
  | "unavailable"
  | "read-only"
  | "enabled"
  | "incompatible"
  | "failed";

export interface TasksWebAccess {
  readonly availability: TasksWebAvailability;
  readonly reason: string;
  readonly extension: ProductExtensionSnapshot | null;
  readonly canReadTasks: boolean;
  readonly canMutateTasks: boolean;
  readonly canReadAgents: boolean;
  readonly canMutateAgents: boolean;
  readonly canReadAutomations: boolean;
  readonly canMutateAutomations: boolean;
}

export interface ResolveTasksWebAccessInput {
  readonly manifest: ProductManifestSnapshot | null | undefined;
  readonly metadataStatus: "loading" | "ready";
}

const NO_ACCESS = {
  canReadTasks: false,
  canMutateTasks: false,
  canReadAgents: false,
  canMutateAgents: false,
  canReadAutomations: false,
  canMutateAutomations: false,
} as const;

function unavailable(
  availability: Exclude<TasksWebAvailability, "read-only" | "enabled">,
  reason: string,
  extension: ProductExtensionSnapshot | null = null,
): TasksWebAccess {
  return { availability, reason, extension, ...NO_ACCESS };
}

function findUnambiguousTasksExtension(
  manifest: ProductManifestSnapshot,
): ProductExtensionSnapshot | null {
  let match: ProductExtensionSnapshot | null = null;
  for (const extension of manifest.extensions) {
    if (extension.id !== TASKS_EXTENSION_ID) continue;
    if (match !== null) return null;
    match = extension;
  }
  return match;
}

function supportsExactCapability(
  manifest: ProductManifestSnapshot,
  id: string,
  version: number,
): boolean {
  return supportsProductCapability(manifest, id, {
    minimum: version,
    maximum: version,
    ownerId: TASKS_EXTENSION_ID,
  });
}

/**
 * Resolves UI affordances from authoritative remote metadata. This is a
 * client-side safety check only; the server remains authoritative.
 */
export function resolveTasksWebAccess(input: ResolveTasksWebAccessInput): TasksWebAccess {
  if (input.metadataStatus === "loading") {
    return unavailable("loading", "Waiting for authoritative extension metadata.");
  }
  const manifest = input.manifest;
  if (!manifest) {
    return unavailable("unavailable", "The connected server did not advertise extension metadata.");
  }
  if (manifest.extensionApiVersion !== TASKS_WEB_SUPPORTED_EXTENSION_API_VERSION) {
    return unavailable(
      "incompatible",
      `Unsupported extension metadata API v${manifest.extensionApiVersion}.`,
    );
  }
  const extension = findUnambiguousTasksExtension(manifest);
  if (!extension) {
    return unavailable(
      "unavailable",
      "The connected server did not advertise one unambiguous Tasks extension.",
    );
  }
  if (!extension.present || extension.state === "unavailable") {
    return unavailable(
      "unavailable",
      "The Tasks extension is not included in this build.",
      extension,
    );
  }
  if (!extension.capable || extension.state === "incompatible") {
    return unavailable(
      "incompatible",
      "The Tasks extension is incompatible with this client.",
      extension,
    );
  }
  if (extension.state === "failed-to-load") {
    return unavailable("failed", "The Tasks extension failed to load safely.", extension);
  }

  const readableState =
    extension.state === "installed-disabled" ||
    extension.state === "enabled-free" ||
    extension.state === "entitlement-required" ||
    extension.state === "enabled-paid" ||
    extension.state === "subscription-expired";
  if (!readableState) {
    return unavailable(
      "incompatible",
      `Unrecognized Tasks extension lifecycle state '${extension.state}'.`,
      extension,
    );
  }

  const activeState = extension.state === "enabled-free" || extension.state === "enabled-paid";
  const canMutate = activeState && extension.enabled;
  const canReadTasks = supportsExactCapability(
    manifest,
    TASKS_RPC_CAPABILITY_ID,
    TASKS_RPC_CONTRACT_VERSION,
  );
  const canReadAgents = supportsExactCapability(
    manifest,
    TASK_AGENTS_RPC_CAPABILITY_ID,
    TASK_AGENTS_RPC_CONTRACT_VERSION,
  );
  const canReadAutomations = supportsExactCapability(
    manifest,
    TASK_AUTOMATIONS_RPC_CAPABILITY_ID,
    TASK_AUTOMATIONS_RPC_CONTRACT_VERSION,
  );
  const hasReadableCapability = canReadTasks || canReadAgents || canReadAutomations;

  if (!hasReadableCapability) {
    return unavailable(
      "incompatible",
      "The connected server did not advertise a compatible Tasks RPC capability.",
      extension,
    );
  }

  return {
    availability: canMutate ? "enabled" : "read-only",
    reason: canMutate
      ? "The Tasks extension is enabled."
      : "Existing extension data is available read-only.",
    extension,
    canReadTasks,
    canMutateTasks: canMutate && canReadTasks,
    canReadAgents,
    canMutateAgents: canMutate && canReadAgents,
    canReadAutomations,
    canMutateAutomations: canMutate && canReadAutomations,
  };
}

export class TasksWebCapabilityUnavailableError extends Error {
  override readonly name = "TasksWebCapabilityUnavailableError";

  constructor(
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`Tasks operation '${operation}' is unavailable: ${reason}`);
  }
}
