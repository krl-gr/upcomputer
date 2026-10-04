import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

/**
 * A task tool as the MCP server lists it. These replace the V1 fork's dynamic
 * tool API: upstream v2 gives every provider the core MCP server, so the task
 * tools register there instead of as per-provider dynamic tools.
 */
export interface TaskToolSpec {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  /** Missing classification fails closed and is treated as a write. */
  readonly mutation?: "read" | "write";
  readonly inputSchema: Record<string, unknown>;
}

export interface TaskToolInvocationContext {
  readonly source: "provider" | "mcp" | "unknown";
  /** Authoritative resolved safety policy. Missing runtime context defaults to deny. */
  readonly mutationPolicy: "allow" | "deny";
  readonly threadId?: ThreadId;
  /** The calling v2 run; V1 called this the turn. */
  readonly turnId?: RunId;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
}

export interface TaskToolCallResult {
  readonly isError: boolean;
  readonly text: string;
}
