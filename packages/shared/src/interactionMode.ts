import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type InteractionModeDescriptor,
  type InteractionModeDescriptorSnapshot,
  type InteractionModeProviderBehavior,
  type InteractionModeSandboxPolicy,
} from "@upcomputer/contracts";
import * as Effect from "effect/Effect";

const STABLE_MODE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PROVIDER_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_ID_LENGTH = 64;

export interface InteractionModeFinalOutputContext {
  readonly modeId: string;
  readonly providerId: string;
}

export interface ExperimentalInteractionModeRegistration<ParsedOutput = unknown> {
  readonly descriptor: InteractionModeDescriptor;
  readonly transformPrompt?: (text: string, context: InteractionModeFinalOutputContext) => string;
  readonly parseFinalOutput?: (
    text: string,
    context: InteractionModeFinalOutputContext,
  ) => ParsedOutput | undefined;
}

export interface ResolvedInteractionMode<ParsedOutput = unknown> {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly intent: InteractionModeDescriptor["intent"];
  readonly safety: InteractionModeDescriptor["safety"];
  readonly outputKind: InteractionModeDescriptor["outputKind"];
  readonly provider: ResolvedInteractionModeProviderBehavior;
  readonly parseFinalOutput:
    | ((text: string, context: InteractionModeFinalOutputContext) => ParsedOutput | undefined)
    | undefined;
  readonly transformPrompt:
    | ((text: string, context: InteractionModeFinalOutputContext) => string)
    | undefined;
}

export interface ResolvedInteractionModeProviderBehavior {
  readonly providerId: string;
  readonly nativeMode: string | undefined;
  readonly nativeModeFallback: InteractionModeProviderBehavior["nativeModeFallback"];
  readonly nativeModePrecedence: InteractionModeProviderBehavior["nativeModePrecedence"];
  readonly collaborationMode: string | undefined;
  readonly permissionMode: string | undefined;
  readonly sandbox: InteractionModeSandboxPolicy;
  readonly developerInstructions: string | undefined;
  readonly promptPrefix: string | undefined;
  readonly promptInputLabel: string | undefined;
}

export interface InteractionModeFinalOutput {
  readonly ownerId: string;
  readonly modeId: string;
  readonly modeVersion: number;
  readonly outputKind: ResolvedInteractionMode["outputKind"];
  readonly output: unknown;
  readonly sourceText: string;
}

type InteractionModeRegistryErrorCode =
  | "invalid-mode-id"
  | "invalid-owner-id"
  | "invalid-version"
  | "invalid-display-metadata"
  | "invalid-unsupported-provider-behavior"
  | "no-supported-provider"
  | "duplicate-mode"
  | "invalid-provider-id"
  | "duplicate-supported-provider"
  | "duplicate-provider-behavior"
  | "missing-provider-behavior"
  | "provider-outside-support"
  | "invalid-provider-behavior"
  | "unsafe-mutation-policy"
  | "unsafe-sandbox-override"
  | "unsafe-computer-use-policy"
  | "unsafe-proposal-policy";

export class InteractionModeRegistryError extends Error {
  readonly _tag = "InteractionModeRegistryError";
  override readonly name = "InteractionModeRegistryError";
  readonly code: InteractionModeRegistryErrorCode;
  readonly modeId: string | undefined;
  readonly providerId: string | undefined;

  constructor(
    code: InteractionModeRegistryErrorCode,
    message: string,
    modeId?: string,
    providerId?: string,
  ) {
    super(message);
    this.code = code;
    this.modeId = modeId;
    this.providerId = providerId;
  }
}

export class InteractionModeResolutionError extends Error {
  readonly _tag = "InteractionModeResolutionError";
  override readonly name = "InteractionModeResolutionError";
  readonly code: "unknown-mode" | "unsupported-provider";
  readonly modeId: string;
  readonly providerId: string;

  constructor(
    code: "unknown-mode" | "unsupported-provider",
    message: string,
    modeId: string,
    providerId: string,
  ) {
    super(message);
    this.code = code;
    this.modeId = modeId;
    this.providerId = providerId;
  }
}

export class InteractionModeProviderBehaviorError extends Error {
  readonly _tag = "InteractionModeProviderBehaviorError";
  override readonly name = "InteractionModeProviderBehaviorError";
  readonly modeId: string;
  readonly providerId: string;
  readonly field: string;
  readonly value: string | undefined;

  constructor(input: {
    readonly modeId: string;
    readonly providerId: string;
    readonly field: string;
    readonly value: string | undefined;
  }) {
    super(
      `Interaction mode '${input.modeId}' has unsupported ${input.field} '${input.value ?? "<missing>"}' for provider '${input.providerId}'.`,
    );
    this.modeId = input.modeId;
    this.providerId = input.providerId;
    this.field = input.field;
    this.value = input.value;
  }
}

/**
 * The removed Orchestrator mode. Threads and agents can still store it; they
 * run as Default. No other unregistered mode falls back.
 */
export const REMOVED_ORCHESTRATOR_INTERACTION_MODE = "orchestrator";

interface StoredInteractionMode {
  readonly registration: ExperimentalInteractionModeRegistration<unknown>;
  readonly providerBehaviors: ReadonlyMap<string, InteractionModeProviderBehavior>;
  readonly supportedProviders: ReadonlySet<string>;
}

/**
 * Deterministic build-time interaction-mode registry.
 *
 * Unknown modes and unsupported providers are rejected. The only fallback is
 * the explicit `effectiveModeId`, for the removed Orchestrator mode stored on
 * existing threads.
 *
 * @experimental This API remains unstable during first-party extraction.
 */
export class ExperimentalInteractionModeRegistry {
  readonly #modes = new Map<string, StoredInteractionMode>();

  constructor(registrations: ReadonlyArray<ExperimentalInteractionModeRegistration> = []) {
    const ordered = [...registrations].sort((left, right) =>
      left.descriptor.id.localeCompare(right.descriptor.id),
    );
    for (const registration of ordered) {
      this.register(registration);
    }
  }

  register(registration: ExperimentalInteractionModeRegistration): void {
    const stored = validateRegistration(registration);
    const modeId = registration.descriptor.id;
    if (this.#modes.has(modeId)) {
      throw new InteractionModeRegistryError(
        "duplicate-mode",
        `Interaction mode '${modeId}' is registered more than once.`,
        modeId,
      );
    }
    this.#modes.set(modeId, stored);
  }

  snapshot(): ReadonlyArray<InteractionModeDescriptorSnapshot> {
    return [...this.#modes.values()]
      .sort((left, right) =>
        left.registration.descriptor.id.localeCompare(right.registration.descriptor.id),
      )
      .map(({ registration }) => {
        const { descriptor } = registration;
        return {
          id: descriptor.id,
          ownerId: descriptor.ownerId,
          version: descriptor.version,
          displayName: descriptor.displayName,
          description: descriptor.description,
          intent: descriptor.intent,
          safety: descriptor.safety,
          outputKind: descriptor.outputKind,
          supportedProviders: [...descriptor.supportedProviders].sort(),
        };
      });
  }

  /**
   * The mode to run for a mode stored on a thread or agent. The removed
   * Orchestrator mode runs as Default. Any other mode is returned unchanged, so
   * an unregistered one, such as an extension mode missing from this build or
   * a misspelled id, is still rejected instead of gaining Default's rights.
   */
  effectiveModeId(modeId: string): string {
    return modeId === REMOVED_ORCHESTRATOR_INTERACTION_MODE &&
      !this.#modes.has(modeId) &&
      this.#modes.has(DEFAULT_PROVIDER_INTERACTION_MODE)
      ? DEFAULT_PROVIDER_INTERACTION_MODE
      : modeId;
  }

  resolve(
    modeId: string,
    providerId: string,
  ): Effect.Effect<ResolvedInteractionMode, InteractionModeResolutionError> {
    return Effect.try({
      try: () => this.resolveOrThrow(modeId, providerId),
      catch: (cause) => {
        if (cause instanceof InteractionModeResolutionError) return cause;
        return new InteractionModeResolutionError(
          "unknown-mode",
          `Interaction mode '${modeId}' could not be resolved.`,
          modeId,
          providerId,
        );
      },
    });
  }

  resolveOrThrow(modeId: string, providerId: string): ResolvedInteractionMode {
    const stored = this.#modes.get(modeId);
    if (stored === undefined) {
      throw new InteractionModeResolutionError(
        "unknown-mode",
        `Interaction mode '${modeId}' is not registered.`,
        modeId,
        providerId,
      );
    }

    if (!stored.supportedProviders.has(providerId)) {
      throw new InteractionModeResolutionError(
        "unsupported-provider",
        `Interaction mode '${modeId}' does not support provider '${providerId}'.`,
        modeId,
        providerId,
      );
    }

    const { descriptor, parseFinalOutput, transformPrompt } = stored.registration;
    const providerBehavior = stored.providerBehaviors.get(providerId);
    return {
      id: descriptor.id,
      ownerId: descriptor.ownerId,
      version: descriptor.version,
      displayName: descriptor.displayName,
      description: descriptor.description,
      intent: descriptor.intent,
      safety: descriptor.safety,
      outputKind: descriptor.outputKind,
      provider: resolveProviderBehavior(providerId, descriptor.safety.sandbox, providerBehavior),
      parseFinalOutput,
      transformPrompt,
    };
  }
}

export function createExperimentalInteractionModeRegistry(
  registrations: ReadonlyArray<ExperimentalInteractionModeRegistration>,
): ExperimentalInteractionModeRegistry {
  return new ExperimentalInteractionModeRegistry(registrations);
}

/** Applies descriptor-provided prompt data without provider-specific mode checks. */
export function applyResolvedInteractionModePrompt(
  text: string,
  mode: ResolvedInteractionMode,
): string {
  if (mode.transformPrompt !== undefined) {
    return mode.transformPrompt(text, {
      modeId: mode.id,
      providerId: mode.provider.providerId,
    });
  }
  const prefix = mode.provider.promptPrefix;
  if (prefix === undefined) return text;

  const trimmed = text.trim();
  if (trimmed.length === 0) return prefix;

  const label = mode.provider.promptInputLabel;
  return label === undefined ? `${prefix}\n\n${trimmed}` : `${prefix}\n\n${label}\n${trimmed}`;
}

const PROPOSED_PLAN_BLOCK_PATTERN = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/g;

export function extractProposedPlanMarkdown(text: string): string | undefined {
  const matches = [...text.matchAll(PROPOSED_PLAN_BLOCK_PATTERN)];
  if (matches.length !== 1) {
    return undefined;
  }
  const planMarkdown = matches[0]?.[1]?.trim();
  return planMarkdown && planMarkdown.length > 0 ? planMarkdown : undefined;
}

export function resolveInteractionModeFinalOutput(
  text: string,
  mode: ResolvedInteractionMode,
): InteractionModeFinalOutput | undefined {
  const sourceText = text.trim();
  if (sourceText.length === 0) {
    return undefined;
  }

  const output =
    mode.parseFinalOutput !== undefined
      ? mode.parseFinalOutput(sourceText, {
          modeId: mode.id,
          providerId: mode.provider.providerId,
        })
      : mode.outputKind === "proposed-plan"
        ? extractProposedPlanMarkdown(sourceText)
        : undefined;

  if (output === undefined) {
    return undefined;
  }

  return {
    ownerId: mode.ownerId,
    modeId: mode.id,
    modeVersion: mode.version,
    outputKind: mode.outputKind,
    output,
    sourceText,
  };
}

function validateRegistration(
  registration: ExperimentalInteractionModeRegistration,
): StoredInteractionMode {
  const { descriptor } = registration;
  if (!STABLE_MODE_ID.test(descriptor.id) || descriptor.id.length > MAX_ID_LENGTH) {
    throw new InteractionModeRegistryError(
      "invalid-mode-id",
      `Interaction mode id '${descriptor.id}' must be a stable lowercase identifier.`,
      descriptor.id,
    );
  }
  if (!STABLE_MODE_ID.test(descriptor.ownerId) || descriptor.ownerId.length > MAX_ID_LENGTH) {
    throw new InteractionModeRegistryError(
      "invalid-owner-id",
      `Interaction mode owner '${descriptor.ownerId}' must be a stable lowercase identifier.`,
      descriptor.id,
    );
  }
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 1) {
    throw new InteractionModeRegistryError(
      "invalid-version",
      `Interaction mode '${descriptor.id}' must have a positive safe-integer version.`,
      descriptor.id,
    );
  }
  if (descriptor.displayName.trim().length === 0 || descriptor.description.trim().length === 0) {
    throw new InteractionModeRegistryError(
      "invalid-display-metadata",
      `Interaction mode '${descriptor.id}' must have non-empty display metadata.`,
      descriptor.id,
    );
  }
  if (descriptor.unsupportedProviderBehavior !== "reject") {
    throw new InteractionModeRegistryError(
      "invalid-unsupported-provider-behavior",
      `Interaction mode '${descriptor.id}' must reject unsupported providers.`,
      descriptor.id,
    );
  }
  if (descriptor.supportedProviders.length === 0) {
    throw new InteractionModeRegistryError(
      "no-supported-provider",
      `Interaction mode '${descriptor.id}' must support at least one explicit provider.`,
      descriptor.id,
    );
  }
  if (descriptor.safety.mutations === "deny" && descriptor.safety.computerUse === "allow") {
    throw new InteractionModeRegistryError(
      "unsafe-computer-use-policy",
      `Interaction mode '${descriptor.id}' denies mutations and cannot allow computer control.`,
      descriptor.id,
    );
  }
  if (
    descriptor.safety.mutations === "deny" &&
    descriptor.safety.sandbox !== "read-only" &&
    descriptor.ownerId !== "upcomputer.core"
  ) {
    // Core Ask/Plan keep their pre-registry provider-native behavior for
    // compatibility. External modes may not claim the same unenforced policy.
    throw new InteractionModeRegistryError(
      "unsafe-mutation-policy",
      `Interaction mode '${descriptor.id}' denies mutations and must request a read-only sandbox.`,
      descriptor.id,
    );
  }
  if (descriptor.intent === "propose" && descriptor.safety.mutations !== "deny") {
    throw new InteractionModeRegistryError(
      "unsafe-proposal-policy",
      `Proposal interaction mode '${descriptor.id}' must deny mutations.`,
      descriptor.id,
    );
  }

  const supportedProviders = new Set<string>();
  for (const providerId of descriptor.supportedProviders) {
    validateProviderId(descriptor.id, providerId);
    if (supportedProviders.has(providerId)) {
      throw new InteractionModeRegistryError(
        "duplicate-supported-provider",
        `Interaction mode '${descriptor.id}' lists provider '${providerId}' more than once.`,
        descriptor.id,
        providerId,
      );
    }
    supportedProviders.add(providerId);
  }

  const providerBehaviors = new Map<string, InteractionModeProviderBehavior>();
  for (const behavior of descriptor.providerBehaviors) {
    validateProviderId(descriptor.id, behavior.providerId);
    if (providerBehaviors.has(behavior.providerId)) {
      throw new InteractionModeRegistryError(
        "duplicate-provider-behavior",
        `Interaction mode '${descriptor.id}' defines provider '${behavior.providerId}' more than once.`,
        descriptor.id,
        behavior.providerId,
      );
    }
    if (!supportedProviders.has(behavior.providerId)) {
      throw new InteractionModeRegistryError(
        "provider-outside-support",
        `Interaction mode '${descriptor.id}' defines behavior for unsupported provider '${behavior.providerId}'.`,
        descriptor.id,
        behavior.providerId,
      );
    }
    for (const [field, value] of [
      ["nativeMode", behavior.nativeMode],
      ["collaborationMode", behavior.collaborationMode],
      ["permissionMode", behavior.permissionMode],
      ["nativeModeFallback", behavior.nativeModeFallback],
      ["nativeModePrecedence", behavior.nativeModePrecedence],
      ["developerInstructions", behavior.developerInstructions],
      ["promptPrefix", behavior.promptPrefix],
      ["promptInputLabel", behavior.promptInputLabel],
    ] as const) {
      if (value !== undefined && value.trim().length === 0) {
        throw new InteractionModeRegistryError(
          "invalid-provider-behavior",
          `Interaction mode '${descriptor.id}' has an empty ${field} for provider '${behavior.providerId}'.`,
          descriptor.id,
          behavior.providerId,
        );
      }
    }
    if (descriptor.safety.sandbox === "read-only" && behavior.sandbox === "inherit-runtime") {
      throw new InteractionModeRegistryError(
        "unsafe-sandbox-override",
        `Interaction mode '${descriptor.id}' cannot weaken read-only safety for provider '${behavior.providerId}'.`,
        descriptor.id,
        behavior.providerId,
      );
    }
    providerBehaviors.set(behavior.providerId, behavior);
  }

  for (const providerId of supportedProviders) {
    if (!providerBehaviors.has(providerId)) {
      throw new InteractionModeRegistryError(
        "missing-provider-behavior",
        `Interaction mode '${descriptor.id}' does not define behavior for supported provider '${providerId}'.`,
        descriptor.id,
        providerId,
      );
    }
  }

  return { registration, providerBehaviors, supportedProviders };
}

function validateProviderId(modeId: string, providerId: string): void {
  if (!PROVIDER_ID.test(providerId) || providerId.length > MAX_ID_LENGTH) {
    throw new InteractionModeRegistryError(
      "invalid-provider-id",
      `Interaction mode '${modeId}' has invalid provider id '${providerId}'.`,
      modeId,
      providerId,
    );
  }
}

function resolveProviderBehavior(
  providerId: string,
  sandbox: InteractionModeSandboxPolicy,
  behavior: InteractionModeProviderBehavior | undefined,
): ResolvedInteractionModeProviderBehavior {
  return {
    providerId,
    nativeMode: behavior?.nativeMode,
    nativeModeFallback: behavior?.nativeModeFallback,
    nativeModePrecedence: behavior?.nativeModePrecedence,
    collaborationMode: behavior?.collaborationMode,
    permissionMode: behavior?.permissionMode,
    sandbox: behavior?.sandbox ?? sandbox,
    developerInstructions: behavior?.developerInstructions,
    promptPrefix: behavior?.promptPrefix,
    promptInputLabel: behavior?.promptInputLabel,
  };
}
