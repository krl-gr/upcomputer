import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const OWNER_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DYNAMIC_TOOL_NAMESPACE = /^[a-zA-Z0-9_-]+$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

export interface ExperimentalDynamicToolSpec {
  readonly type: "function";
  readonly name: string;
  readonly namespace?: string;
  readonly description: string;
  /** Missing classification fails closed and is treated as a write. */
  readonly mutation?: "read" | "write";
  readonly inputSchema: Record<string, unknown>;
}

export interface ExperimentalDynamicToolInvocationContext {
  readonly source: "provider" | "mcp" | "unknown";
  /** Authoritative resolved safety policy. Missing runtime context defaults to deny. */
  readonly mutationPolicy: "allow" | "deny";
  readonly threadId?: ThreadId;
  readonly turnId?: TurnId;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
}

export interface ExperimentalDynamicToolCallResult {
  readonly isError: boolean;
  readonly text: string;
}

export interface ExperimentalDynamicToolRegistration<R = never, E = never> {
  readonly spec: ExperimentalDynamicToolSpec;
  readonly execute: (
    input: Record<string, unknown>,
    context: ExperimentalDynamicToolInvocationContext,
  ) => Effect.Effect<ExperimentalDynamicToolCallResult, E, R>;
}

export interface ExperimentalDynamicToolOwner<R = never, E = never> {
  readonly ownerId: string;
  readonly version: number;
  readonly tools: ReadonlyArray<ExperimentalDynamicToolRegistration<R, E>>;
}

export interface ExperimentalDynamicToolSnapshot {
  readonly revision: number;
  readonly owners: ReadonlyArray<{
    readonly ownerId: string;
    readonly version: number;
    readonly toolNames: ReadonlyArray<string>;
  }>;
  readonly specs: ReadonlyArray<ExperimentalDynamicToolSpec>;
}

export interface ExperimentalDynamicToolLease<
  R = never,
  E = never,
> extends ExperimentalDynamicToolSnapshot {
  readonly execute: (
    toolName: string,
    input: Record<string, unknown>,
    context?: ExperimentalDynamicToolInvocationContext,
  ) => Effect.Effect<ExperimentalDynamicToolCallResult, E | DynamicToolRegistryError, R>;
}

type DynamicToolRegistryErrorCode =
  | "invalid-owner-id"
  | "invalid-owner-version"
  | "invalid-tool-name"
  | "invalid-tool-namespace"
  | "invalid-tool-description"
  | "duplicate-owner"
  | "duplicate-tool"
  | "unknown-tool";

export class DynamicToolRegistryError extends Error {
  override readonly name = "DynamicToolRegistryError";
  readonly code: DynamicToolRegistryErrorCode;
  readonly ownerId: string | undefined;
  readonly toolName: string | undefined;

  constructor(
    code: DynamicToolRegistryErrorCode,
    message: string,
    ownerId?: string,
    toolName?: string,
  ) {
    super(message);
    this.code = code;
    this.ownerId = ownerId;
    this.toolName = toolName;
  }
}

interface RegisteredTool<R, E> {
  readonly ownerId: string;
  readonly registration: ExperimentalDynamicToolRegistration<R, E>;
}

/**
 * Process-local, owner-scoped registry for provider dynamic tools.
 *
 * Registration is atomic per owner. Provider sessions retain an immutable
 * lease, so disabling an extension changes future sessions without invalidating
 * an in-flight tool call. Tool handlers should close over already-constructed
 * feature services and therefore have no remaining environment requirements.
 */
export class ExperimentalDynamicToolRegistry<R = never, E = never> {
  readonly #owners = new Map<string, ExperimentalDynamicToolOwner<R, E>>();
  readonly #tools = new Map<string, RegisteredTool<R, E>>();
  #revision = 0;

  register(owner: ExperimentalDynamicToolOwner<R, E>): void {
    validateOwner(owner);
    if (this.#owners.has(owner.ownerId)) {
      throw new DynamicToolRegistryError(
        "duplicate-owner",
        `Dynamic-tool owner '${owner.ownerId}' is already registered.`,
        owner.ownerId,
      );
    }

    const ownerToolNames = new Set<string>();
    for (const tool of owner.tools) {
      validateTool(owner.ownerId, tool.spec);
      if (ownerToolNames.has(tool.spec.name) || this.#tools.has(tool.spec.name)) {
        const existingOwner = this.#tools.get(tool.spec.name)?.ownerId ?? owner.ownerId;
        throw new DynamicToolRegistryError(
          "duplicate-tool",
          `Dynamic tool '${tool.spec.name}' is already owned by '${existingOwner}'.`,
          owner.ownerId,
          tool.spec.name,
        );
      }
      ownerToolNames.add(tool.spec.name);
    }

    this.#owners.set(owner.ownerId, owner);
    for (const registration of owner.tools) {
      this.#tools.set(registration.spec.name, { ownerId: owner.ownerId, registration });
    }
    this.#revision += 1;
  }

  unregister(ownerId: string): boolean {
    const owner = this.#owners.get(ownerId);
    if (owner === undefined) return false;
    for (const tool of owner.tools) this.#tools.delete(tool.spec.name);
    this.#owners.delete(ownerId);
    this.#revision += 1;
    return true;
  }

  snapshot(): ExperimentalDynamicToolSnapshot {
    const owners = [...this.#owners.values()]
      .sort((left, right) => left.ownerId.localeCompare(right.ownerId))
      .map((owner) => ({
        ownerId: owner.ownerId,
        version: owner.version,
        toolNames: owner.tools.map(({ spec }) => spec.name).sort(),
      }));
    const specs = [...this.#tools.values()]
      .map(({ registration }) => registration.spec)
      .sort((left, right) => left.name.localeCompare(right.name));
    return { revision: this.#revision, owners, specs };
  }

  lease(): ExperimentalDynamicToolLease<R, E> {
    const snapshot = this.snapshot();
    const tools = new Map(this.#tools);
    return {
      ...snapshot,
      execute: (toolName, input, context = { source: "unknown", mutationPolicy: "deny" }) =>
        executeRegisteredTool(tools, toolName, input, context),
    };
  }

  execute(
    toolName: string,
    input: Record<string, unknown>,
    context: ExperimentalDynamicToolInvocationContext = {
      source: "unknown",
      mutationPolicy: "deny",
    },
  ): Effect.Effect<ExperimentalDynamicToolCallResult, E | DynamicToolRegistryError, R> {
    return executeRegisteredTool(this.#tools, toolName, input, context);
  }
}

export class ExperimentalDynamicToolRegistryService extends Context.Service<
  ExperimentalDynamicToolRegistryService,
  ExperimentalDynamicToolRegistry<never, never>
>()("t3/product/DynamicToolRegistry/ExperimentalDynamicToolRegistryService") {}

/** Registers one fully captured owner for exactly the lifetime of its feature layer. */
export function experimentalDynamicToolOwnerLayer(
  owner: ExperimentalDynamicToolOwner<never, never>,
) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* ExperimentalDynamicToolRegistryService;
      yield* Effect.acquireRelease(
        Effect.sync(() => registry.register(owner)),
        () => Effect.sync(() => registry.unregister(owner.ownerId)),
      );
    }),
  );
}

function executeRegisteredTool<R, E>(
  tools: ReadonlyMap<string, RegisteredTool<R, E>>,
  toolName: string,
  input: Record<string, unknown>,
  context: ExperimentalDynamicToolInvocationContext,
): Effect.Effect<ExperimentalDynamicToolCallResult, E | DynamicToolRegistryError, R> {
  const tool = tools.get(toolName);
  if (tool === undefined) {
    return Effect.fail(
      new DynamicToolRegistryError(
        "unknown-tool",
        `Dynamic tool '${toolName}' is not registered.`,
        undefined,
        toolName,
      ),
    );
  }
  if (context.mutationPolicy !== "allow" && tool.registration.spec.mutation !== "read") {
    return Effect.succeed({
      isError: true,
      text: `Mutation denied for dynamic tool '${toolName}' by the active interaction mode.`,
    });
  }
  return tool.registration.execute(input, context);
}

function validateOwner<R, E>(owner: ExperimentalDynamicToolOwner<R, E>): void {
  if (!OWNER_ID.test(owner.ownerId)) {
    throw new DynamicToolRegistryError(
      "invalid-owner-id",
      `Dynamic-tool owner '${owner.ownerId}' must be a lowercase dot, dash, or underscore separated identifier.`,
      owner.ownerId,
    );
  }
  if (!Number.isSafeInteger(owner.version) || owner.version <= 0) {
    throw new DynamicToolRegistryError(
      "invalid-owner-version",
      `Dynamic-tool owner '${owner.ownerId}' must have a positive safe integer version.`,
      owner.ownerId,
    );
  }
}

function validateTool(ownerId: string, spec: ExperimentalDynamicToolSpec): void {
  if (!TOOL_NAME.test(spec.name)) {
    throw new DynamicToolRegistryError(
      "invalid-tool-name",
      `Dynamic tool '${spec.name}' must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.`,
      ownerId,
      spec.name,
    );
  }
  if (spec.namespace !== undefined && !DYNAMIC_TOOL_NAMESPACE.test(spec.namespace)) {
    throw new DynamicToolRegistryError(
      "invalid-tool-namespace",
      `Dynamic tool '${spec.name}' namespace '${spec.namespace}' must contain only letters, numbers, underscores, and hyphens.`,
      ownerId,
      spec.name,
    );
  }
  if (spec.description.trim().length === 0) {
    throw new DynamicToolRegistryError(
      "invalid-tool-description",
      `Dynamic tool '${spec.name}' must have a non-empty description.`,
      ownerId,
      spec.name,
    );
  }
}

export function createExperimentalDynamicToolRegistry<R = never, E = never>(
  owners: ReadonlyArray<ExperimentalDynamicToolOwner<R, E>> = [],
): ExperimentalDynamicToolRegistry<R, E> {
  const registry = new ExperimentalDynamicToolRegistry<R, E>();
  for (const owner of owners) registry.register(owner);
  return registry;
}

/** Empty registry layer for isolated core runtimes and focused tests. */
export const ExperimentalDynamicToolRegistryEmpty = Layer.sync(
  ExperimentalDynamicToolRegistryService,
  () => createExperimentalDynamicToolRegistry(),
);
