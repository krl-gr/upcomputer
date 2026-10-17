import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

/**
 * A `t3-code` MCP tool a product feature wants a thread's agent to call
 * without looking it up first, with a short argument shape such as
 * `{id, status?}`. Codex code mode keeps MCP tools out of the model's context,
 * so without a hint the agent spends a model call on an ALL_TOOLS lookup
 * before it can call a tool.
 */
export interface ToolCallHint {
  readonly name: string;
  readonly args: string;
}

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /**
   * Adapters read it to keep developer instructions truthful: when the user
   * withholds agent browser access, the prompt must not advertise `preview_*`
   * tools that every call would reject.
   */
  readonly browserToolsAvailable: boolean;
  /**
   * False when the session's agent should not get the orchestration block,
   * as decided by `orchestrationInstructionsFor`. The tools stay callable;
   * this only keeps their long guide out of every model call. Defaults to true.
   */
  readonly orchestrationInstructions?: boolean;
  /** Tools the agent may call without a lookup, as decided by `toolCallHintsFor`. */
  readonly toolCallHints?: ReadonlyArray<ToolCallHint>;
  readonly capabilities?: ReadonlySet<string>;
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
}

/** Whether a session with this MCP config gets the orchestration block. */
export function wantsOrchestrationInstructions(
  config: Pick<McpProviderSessionConfig, "orchestrationInstructions"> | undefined,
): boolean {
  return config !== undefined && config.orchestrationInstructions !== false;
}

export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}
